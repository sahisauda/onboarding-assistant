const { google } = require('googleapis');
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { OpenAIEmbeddings } = require("@langchain/openai");
const { Document } = require("@langchain/core/documents");
const path = require('path');
const pdfParse = require('pdf-parse');

// Build a Drive client using the Service Account credentials from the environment.
// This means users don't need to grant "See and download all your Google Drive files" permission.
function getServiceAccountDriveClient() {
    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not set in .env');
    const key = JSON.parse(keyJson);
    const auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    return google.drive({ version: 'v3', auth });
}

// Fallback Simple Vector Store since Langchain memory store export is broken in this package combination
// Now includes Keyword search fallback for providers that don't support embeddings (like Groq)
class SimpleVectorStore {
    constructor(embeddings) {
        this.embeddings = embeddings;
        this.store = [];
        this.supportsEmbeddings = true;
    }

    async addDocuments(documents) {
        if (documents.length === 0) return;

        try {
            const texts = documents.map(d => d.pageContent);
            const vectors = await this.embeddings.embedDocuments(texts);

            for (let i = 0; i < documents.length; i++) {
                this.store.push({
                    document: documents[i],
                    vector: vectors[i],
                    text: documents[i].pageContent.toLowerCase()
                });
            }
        } catch (e) {
            console.warn("Embeddings generation failed, falling back to keyword search:", e.message);
            this.supportsEmbeddings = false;
            // Just store the documents for keyword matching
            for (const doc of documents) {
                this.store.push({
                    document: doc,
                    text: doc.pageContent.toLowerCase()
                });
            }
        }
    }

    async similaritySearch(query, k = 3) {
        if (this.store.length === 0) return [];
        const lowQuery = query.toLowerCase();

        if (this.supportsEmbeddings) {
            try {
                const queryVector = await this.embeddings.embedQuery(query);
                const similarities = this.store.map(item => ({
                    document: item.document,
                    similarity: this.cosineSimilarity(queryVector, item.vector)
                }));
                similarities.sort((a, b) => b.similarity - a.similarity);
                return similarities.slice(0, k).map(item => item.document);
            } catch (e) {
                console.warn("Embedding query failed, using keyword fallback.");
                this.supportsEmbeddings = false;
            }
        }

        // Keyword Match Fallback (Basic BM25-ish / Frequency)
        const keywords = lowQuery.split(/\s+/).filter(w => w.length > 3);
        const scoredDocs = this.store.map(item => {
            let score = 0;
            keywords.forEach(word => {
                if (item.text.includes(word)) score += 1;
            });
            return { document: item.document, score };
        });

        scoredDocs.sort((a, b) => b.score - a.score);
        return scoredDocs.slice(0, k).map(item => item.document);
    }

    cosineSimilarity(vecA, vecB) {
        if (!vecA || !vecB) return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}

const VECTOR_STORES = {}; // In-memory store per user email and folder combination

// Helper to recursively fetch all relevant files from a folder and its subfolders
async function getAllFiles(drive, folderId) {  // drive is already a service account client
    let allFiles = [];
    const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id, name, mimeType)',
    });

    const files = res.data.files || [];
    for (const file of files) {
        if (file.mimeType === 'application/vnd.google-apps.folder') {
            const subFiles = await getAllFiles(drive, file.id);
            allFiles = allFiles.concat(subFiles);
        } else {
            allFiles.push(file);
        }
    }
    return allFiles;
}

// Note: authClient parameter removed — Drive access now uses service account internally.
async function getOrBuildVectorStore(userEmail, folderId) {
    const cacheKey = `${userEmail}:${folderId}`;
    if (VECTOR_STORES[cacheKey]) {
        return VECTOR_STORES[cacheKey];
    }

    console.log(`Building vector store for user ${userEmail} and folder ${folderId}...`);
    const drive = getServiceAccountDriveClient();

    try {
        // 1. Fetch files recursively
        const files = await getAllFiles(drive, folderId);
        console.log(`Retrieved ${files.length} file entries from folder tree [${folderId}]`);

        if (!files || files.length === 0) {
            console.log(`ALERT: No files found for user ${userEmail} in folder ${folderId}. This might be due to empty folder or lack of permissions to list children.`);
            const embeddings = new OpenAIEmbeddings({
                openAIApiKey: process.env.OPENAI_API_KEY,
                configuration: { baseURL: process.env.OPENAI_BASE_URL }
            });
            const store = new SimpleVectorStore(embeddings);
            await store.addDocuments([new Document({ pageContent: "No documents exist in this selected folder. Please ensure the folder is not empty and you have shared it with the assistant account if necessary." })]);
            VECTOR_STORES[cacheKey] = store;
            return store;
        }

        const documents = [];
        console.log(`Processing up to 10 files from ${userEmail}'s folder...`);

        // 2. Download and parse files in parallel (Max 5 at a time to avoid rate limits)
        const processFile = async (file) => {
            let rawText = '';
            try {
                if (file.mimeType === 'application/pdf') {
                    const response = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' });
                    const data = await pdfParse(response.data);
                    rawText = data.text;
                } else if (file.mimeType === 'application/vnd.google-apps.document') {
                    const response = await drive.files.export({ fileId: file.id, mimeType: 'text/plain' }, { responseType: 'text' });
                    rawText = response.data;
                } else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
                    const response = await drive.files.export({ fileId: file.id, mimeType: 'text/csv' }, { responseType: 'text' });
                    rawText = response.data;
                } else if (file.mimeType.startsWith('text/')) {
                    const response = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'text' });
                    rawText = response.data;
                } else {
                    return null;
                }

                if (rawText && rawText.trim().length > 0) {
                    return new Document({
                        pageContent: rawText.substring(0, 50000), // Limit per file for speed
                        metadata: { source: file.name, id: file.id }
                    });
                }
            } catch (err) {
                console.error(`Failed to process ${file.name}:`, err);
            }
            return null;
        };

        // 2. Download and parse files in parallel (Max 10 at a time)
        const processFileWithTimeout = async (file) => {
            const timeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('File processing timeout')), 15000)
            );
            try {
                console.log(`- Start processing: ${file.name} (${file.mimeType})`);
                return await Promise.race([processFile(file), timeout]);
            } catch (err) {
                console.error(`- Error/Timeout processing ${file.name}:`, err.message);
                return null;
            }
        };

        const docPromises = files.slice(0, 10).map(file => processFileWithTimeout(file));
        const results = await Promise.all(docPromises);
        results.forEach(d => { if (d) documents.push(d); });

        if (documents.length === 0) {
            documents.push(new Document({ pageContent: "The drive folder tree had files, but none could be parsed as text, PDF, Google Doc, Sheet, or Slide." }));
        }

        // 3. Chunk the documents
        const splitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
        });
        const splitDocs = await splitter.splitDocuments(documents);

        // 4. Create Vector Store
        const vectorStore = new SimpleVectorStore(
            new OpenAIEmbeddings({
                openAIApiKey: process.env.OPENAI_API_KEY,
                configuration: {
                    baseURL: process.env.OPENAI_BASE_URL
                }
            })
        );
        await vectorStore.addDocuments(splitDocs);

        VECTOR_STORES[cacheKey] = vectorStore;
        console.log(`Finished building vector store for ${userEmail} [${folderId}]. Added ${splitDocs.length} chunks.`);
        return vectorStore;

    } catch (error) {
        console.error('Error fetching from Drive:', error);
        throw error;
    }
}

function clearVectorStore(userEmail) {
    // Clear all stores for this user
    Object.keys(VECTOR_STORES).forEach(key => {
        if (key.startsWith(`${userEmail}:`)) {
            delete VECTOR_STORES[key];
        }
    });
}

module.exports = { getOrBuildVectorStore, clearVectorStore };
