require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const { google } = require('googleapis');

// Langchain imports
const { ChatOpenAI } = require('@langchain/openai');
const { PromptTemplate } = require('@langchain/core/prompts');
const { StringOutputParser } = require('@langchain/core/output_parsers');
const { RunnableSequence } = require('@langchain/core/runnables');
const { getOrBuildVectorStore } = require('./ragBuilder');
const { sendEmail } = require('./emailService');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// OAuth2 Setup
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

// Scopes for Drive and Gmail
const SCOPES = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email'
];

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Mock Database / State
const upload = multer({ dest: 'uploads/' });
let faqs = [];
let onboardingStatus = { steps: [{ id: 1, text: "Set up laptop", completed: false }] };

// --- Authentication Routes ---

app.get('/api/auth/status', (req, res) => {
    if (req.session.tokens) {
        return res.json({ authenticated: true, user: req.session.user });
    }
    res.json({ authenticated: false });
});

app.get('/auth/google', (req, res) => {
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent', // Force to get refresh token
        scope: SCOPES
    });
    res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        req.session.tokens = tokens;

        // Get user profile info
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        const email = userInfo.data.email;

        // Initialize user in our mock DB and check if admin
        const userData = db.getUser(email);

        req.session.user = {
            name: userInfo.data.name,
            email: email,
            picture: userInfo.data.picture,
            role: userData.role,
            allowedFolders: userData.allowedFolders
        };

        // Redirect back to main page
        res.redirect('/');
    } catch (error) {
        console.error('Error during Google Auth Callback:', error);
        res.redirect('/?error=auth_failed');
    }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Middleware to check authentication
function requireAuth(req, res, next) {
    if (!req.session.tokens) {
        return res.status(401).json({ error: "Authentication required" });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.tokens || (req.session.user && req.session.user.role !== 'admin')) {
        return res.status(403).json({ error: "Access Denied: Admin role required" });
    }
    next();
}

// Helper to get authorized Drive client
function getDriveClient(tokens) {
    const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    auth.setCredentials(tokens);
    return google.drive({ version: 'v3', auth });
}

// Endpoint to list subfolders of the primary Drive folder
// Endpoint to list folders
app.get('/api/folders', requireAuth, async (req, res) => {
    const drive = getDriveClient(req.session.tokens);
    const parentFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const userRole = req.session.user.role;
    const allowedFolderIds = req.session.user.allowedFolders || [];

    try {
        let folders = [];

        if (userRole === 'admin') {
            // Admin sees subfolders of the master root for management
            if (parentFolderId) {
                const response = await drive.files.list({
                    q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
                    fields: 'files(id, name)',
                });
                folders = response.data.files || [];
                folders.unshift({ id: parentFolderId, name: "Master Root" });
            }
        } else {
            // Non-admins see ONLY their allowed folders as "Root" options
            // We fetch their names individually since they might be scattered across Drive
            const folderPromises = allowedFolderIds.map(async (id) => {
                try {
                    const f = await drive.files.get({ fileId: id, fields: 'id, name' });
                    return f.data;
                } catch (e) { return null; }
            });
            folders = (await Promise.all(folderPromises)).filter(f => f !== null);
        }

        res.json({ folders });
    } catch (error) {
        console.error('Error fetching folders:', error);
        res.status(500).json({ error: "Could not fetch folders." });
    }
});

app.get('/api/admin/folder-name', requireAuth, requireAdmin, async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "ID required" });
    try {
        const drive = getDriveClient(req.session.tokens);
        const folder = await drive.files.get({ fileId: id, fields: 'name' });
        res.json({ name: folder.data.name });
    } catch (e) {
        console.error(`Folder resolution error for ${id}:`, e.message);
        const status = e.code || 500;
        const msg = status === 404 ? "Folder ID not found." : "Access Denied: Is the folder shared with your account?";
        res.status(status).json({ error: msg });
    }
});

// Initialize LLM (configured for OpenAI or Groq/Grok via BASE_URL)
const llm = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: 0.2, // Low temperature for more factual answers
    configuration: {
        baseURL: process.env.OPENAI_BASE_URL // Points to api.groq.com if configured
    },
    modelName: process.env.GROQ_MODEL_NAME || 'gpt-4o-mini'
});

// RAG/Chat Endpoint
app.post('/api/chat', requireAuth, async (req, res) => {
    const { message, role, folderId: requestedFolderId } = req.body;

    const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    auth.setCredentials(req.session.tokens);

    try {
        const userEmail = req.session.user.email;
        const userRole = req.session.user.role;
        const allowedFolderIds = req.session.user.allowedFolders || [];

        // Determine which folder to use
        let folderId = requestedFolderId;

        if (!folderId) {
            if (userRole === 'admin') {
                folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
            } else if (allowedFolderIds.length > 0) {
                folderId = allowedFolderIds[0]; // Default to user's first assigned folder
            } else {
                return res.status(400).json({ reply: '❌ No folders assigned to your account. Please contact an admin.' });
            }
        }

        console.log(`Chat request from ${userEmail} for folder ${folderId}`);

        // RBAC Check for Chat Request
        if (userRole !== 'admin' && !allowedFolderIds.includes(folderId)) {
            console.warn(`Unauthorized access attempt by ${userEmail} to folder ${folderId}`);
            return res.status(403).json({ reply: '❌ Access Denied: You do not have permission to query this folder. Please contact an admin.' });
        }

        if (!folderId) {
            return res.status(500).json({ reply: 'Server Configuration Error: Google Drive Folder ID is missing.' });
        }

        // Get or build the user's vector store from their Drive folder
        const vectorStore = await getOrBuildVectorStore(userEmail, auth, folderId);

        // Setup the RAG Prompt
        const promptInfo = PromptTemplate.fromTemplate(`
You are the Ranosys AI Assistant, a highly capable intelligence integrated directly into the Ranosys Google Workspace.
Your goal is to provide accurate, professional, and helpful answers strictly based on the provided document context from the Ranosys Google Drive.

LANGUAGE & STYLE:
- By default, always answer in clear, professional English.
- ONLY if the user asks in Hinglish or Hindi, you should respond in professional Hinglish.
- Keep answers extremely fast, sharp, and helpful.

SEARCH DEPTH:
- Scan EVERY PIECE of provided context carefully to find the most relevant details across all documents.
- If multiple documents mention the topic, synthesize a complete answer.

Role of the user asking the question: {role}

Use the following pieces of retrieved context to answer the question.
If the answer is not in the context, clearly say so and do not invent an answer.
Keep your answers professional and clear.

IMPORTANT AUTOMATION RULES:
1. If the user asks you to send an email, verify you have the recipient email address, subject, and body.
   If you have all three, you MUST start your response exactly with this prefix format:
   SEND_EMAIL:::recipient@example.com:::Email Subject:::The email body content.
   Do not include any other text before SEND_EMAIL.

2. PROACTIVE HELP: Always conclude your response with 2-3 helpful next steps or follow-up questions relevant to the answer.
   Format these at the VERY END of your response on a new line starting with "SUGGESTIONS:::".
   Example: SUGGESTIONS:::Would you like me to email this policy?, Tell me more about Ranosys, How do I apply?

Context: 
{context}

Question: {input}
Answer:`);

        // Create the sequence to get context FIRST (this is the RAG part)
        const contextProvider = async (inputParams) => {
            const isGroq = process.env.OPENAI_BASE_URL && process.env.OPENAI_BASE_URL.includes('groq');
            if (isGroq) vectorStore.supportsEmbeddings = false;

            const docs = await vectorStore.similaritySearch(inputParams.input, 5);
            return docs.map(d => d.pageContent).join("\n\n---\n\n") || "No document context found.";
        };

        const context = await contextProvider({ input: message });
        const finalPrompt = await promptInfo.format({
            context,
            input: message,
            role: role || 'Employee'
        });

        // Set headers for streaming
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        let fullText = '';
        const stream = await llm.stream(finalPrompt);

        for await (const chunk of stream) {
            const content = chunk.content;
            fullText += content;
            res.write(`data: ${JSON.stringify({ chunk: content })}\n\n`);
        }

        // Post-processing for suggestions and emails
        let suggestions = [];
        if (fullText.includes('SUGGESTIONS:::')) {
            const parts = fullText.split('SUGGESTIONS:::');
            suggestions = parts[1].split(',').map(s => s.trim()).filter(s => s.length > 0);
        }

        // Parse Email Intent
        if (fullText.startsWith('SEND_EMAIL:::')) {
            const parts = fullText.split(':::');
            if (parts.length >= 4) {
                const toEmail = parts[1].trim();
                const subject = parts[2].trim();
                const body = parts.slice(3).join(':::').trim();
                try {
                    await sendEmail(auth, toEmail, subject, body);
                    res.write(`data: ${JSON.stringify({ emailSent: true, to: toEmail })}\n\n`);
                } catch (e) {
                    console.error("Email error", e);
                }
            }
        }

        res.write(`data: ${JSON.stringify({ done: true, suggestions })}\n\n`);
        res.end();

    } catch (error) {
        console.error('LLM/Chat error:', error);
        res.status(500).write(`data: ${JSON.stringify({ error: "Context building failed. This usually happens on large folders. Please retry." })}\n\n`);
        res.end();
    }
});

app.get('/api/admin/analytics', requireAdmin, (req, res) => {
    res.json({ totalMessages: 0, activeUsersToday: 0, topIntents: [] });
});

// Admin User Management Endpoints
app.get('/api/admin/users', requireAdmin, (req, res) => {
    res.json({ users: db.getAllUsers() });
});

app.post('/api/admin/users/update', requireAuth, requireAdmin, async (req, res) => {
    const { email, role, allowedFolders } = req.body;
    const updatedUser = db.updateUser(email, { role, allowedFolders });

    if (updatedUser) {
        // Send email to the user about access change
        const portalUrl = process.env.PORTAL_URL || `${req.protocol}://${req.get('host')}`;

        const authClient = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );
        authClient.setCredentials(req.session.tokens);

        try {
            await sendEmail(authClient, email, "Ranosys AI: Access Updated", `
                Hi,<br><br>
                Your access to the Ranosys AI Workspace has been updated.<br>
                You can now access the portal here: <a href="${portalUrl}">${portalUrl}</a><br><br>
                Please login with your Ranosys Google account.
            `);
        } catch (e) { console.error("Notification email failed", e); }

        res.json({ success: true, user: updatedUser });
    } else {
        res.status(404).json({ error: "User not found" });
    }
});

app.post('/api/admin/users/bulk-assign', requireAuth, requireAdmin, async (req, res) => {
    const { emails, folderId } = req.body;
    if (!emails || !folderId) {
        return res.status(400).json({ error: "Missing emails or folderId" });
    }
    const emailList = Array.isArray(emails) ? emails : emails.split(',').map(e => e.trim()).filter(e => e.length > 0);
    db.bulkAssign(emailList, folderId);

    const authClient = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
    );
    authClient.setCredentials(req.session.tokens);

    // Send emails in background
    const portalUrl = process.env.PORTAL_URL || `${req.protocol}://${req.get('host')}`;
    const portalLink = `<a href="${portalUrl}">${portalUrl}</a>`;

    const emailPromises = emailList.map(email =>
        sendEmail(authClient, email, "Ranosys AI: Access Granted", `
            Welcome to Ranosys AI Workspace!<br><br>
            You have been granted access to a new Knowledge Source.<br>
            Access the portal at: ${portalLink}<br><br>
            Happy Searching!
        `).catch(err => console.error(`Email failed for ${email}`, err))
    );

    await Promise.all(emailPromises);

    res.json({ success: true, message: `Assigned ${emailList.length} users and sent notifications.` });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.OPENAI_API_KEY) {
        console.warn('WARNING: Missing required environment variables in .env');
    }
});
