document.addEventListener('DOMContentLoaded', async () => {
    const loginOverlay = document.getElementById('login-overlay');
    const appContent = document.getElementById('app-content');
    const userProfileDiv = document.getElementById('user-profile');
    const logoutBtn = document.getElementById('logout-btn');

    const chatForm = document.getElementById('chat-form');
    const messageInput = document.getElementById('message-input');
    const chatMessages = document.getElementById('chat-messages');
    const roleSelector = document.getElementById('role');
    const folderSelect = document.getElementById('folder-select');
    const folderContainer = document.getElementById('folder-selection-container');
    const micBtn = document.getElementById('mic-btn');

    // 1. Check Authentication Status
    try {
        const authRes = await fetch('/api/auth/status');
        const authData = await authRes.json();

        if (!authData.authenticated) {
            // Show Login Overlay
            loginOverlay.style.display = 'flex';
            appContent.style.display = 'none';
            return; // Stop initialization until logged in
        } else {
            // Logged in
            loginOverlay.style.display = 'none';
            appContent.style.display = 'flex';

            // Populate user info
            if (authData.user) {
                const isAdmin = authData.user.role === 'admin';
                userProfileDiv.innerHTML = `
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <img src="${authData.user.picture}" alt="Profile" style="width: 40px; border-radius: 50%;">
                            <div>
                                <div style="font-weight: 600; font-size: 0.9rem;">${authData.user.name}</div>
                                <div style="font-size: 0.75rem; color: var(--text-secondary);">${authData.user.email}</div>
                                ${isAdmin ? '<span class="role-badge" style="font-size: 0.65rem; padding: 2px 5px; background: rgba(255,59,10,0.2); color: var(--accent-primary); border-radius: 4px; font-weight: 700;">ADMIN</span>' : ''}
                            </div>
                        </div>
                    </div>
                `;

                if (isAdmin) {
                    initAdminControls();
                }
            }

            // Load Drive Folders
            loadFolders();
        }
    } catch (e) {
        console.error("Auth check failed", e);
    }

    // 2. Main Chat Logic
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const message = messageInput.value.trim();
        if (!message) return;

        // Clear old suggestions
        const suggestionsDiv = document.getElementById('suggestions');
        suggestionsDiv.innerHTML = '';

        addMessage(message, true);
        messageInput.value = '';

        const aiMsgId = "msg-" + Date.now();
        addMessage("", false, aiMsgId);
        const bubble = document.getElementById(aiMsgId).querySelector('.bubble');
        bubble.innerHTML = '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';

        try {
            const role = roleSelector.value;
            const folderId = folderSelect.value;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, role, folderId }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.status === 401) {
                window.location.reload();
                return;
            }

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                bubble.innerHTML = `<span style="color:var(--error-color)">${errData.reply || errData.error || 'Server error. Please try again.'}</span>`;
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = "";
            let chunkCount = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            chunkCount++;

                            if (data.chunk) {
                                if (fullText === "") bubble.innerHTML = ""; // Clear typing indicator
                                fullText += data.chunk;
                                bubble.innerText = fullText;
                                scrollToBottom();
                            }

                            if (data.emailSent) {
                                bubble.innerHTML += `<div style="margin-top:10px; color:var(--success-color); font-weight:600;"><i class="fas fa-check-circle"></i> Email sent to ${data.to}</div>`;
                            }

                            if (data.done) {
                                bubble.innerHTML = fullText.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                                if (data.suggestions && data.suggestions.length > 0) {
                                    suggestionsDiv.innerHTML = data.suggestions.map(s =>
                                        `<button class="suggestion-btn" onclick="sendSuggestion('${s.replace(/'/g, "\\'")}')">${s}</button>`
                                    ).join('');
                                }
                                scrollToBottom();
                            }

                            if (data.error) {
                                bubble.innerHTML = `<span style="color:var(--error-color)">${data.error}</span>`;
                            }
                        } catch (e) { }
                    }
                }
            }

            if (chunkCount === 0 && fullText === "") {
                bubble.innerHTML = `<span style="color:var(--error-color)">Thinking timed out or no data received. This usually happens if the folder is too large. Please retry with a smaller folder.</span>`;
            }

        } catch (error) {
            console.error('Chat error:', error);
            if (error.name === 'AbortError') {
                bubble.innerHTML = '<span style="color:var(--error-color)">Request timed out. Google Drive is taking too long to respond.</span>';
            } else {
                bubble.innerHTML = '<span style="color:var(--error-color)">Could not connect to the server. Please check your internet.</span>';
            }
        }
    });

    logoutBtn.addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.reload();
    });

    // 3. Voice Command Implementation
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.lang = 'en-US';
        recognition.interimResults = false;

        let isListening = false;

        micBtn.addEventListener('click', () => {
            if (isListening) {
                recognition.stop();
            } else {
                recognition.start();
            }
        });

        recognition.onstart = () => {
            isListening = true;
            micBtn.classList.add('active');
            messageInput.placeholder = "Listening...";
        };

        recognition.onend = () => {
            isListening = false;
            micBtn.classList.remove('active');
            messageInput.placeholder = "Ask about your documents...";
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            messageInput.value = transcript;
            // Optionally auto-submit:
            // chatForm.dispatchEvent(new Event('submit'));
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            isListening = false;
            micBtn.classList.remove('active');
        };
    } else {
        micBtn.style.display = 'none'; // Hide if not supported
    }

    window.toggleSettings = () => {
        const settings = document.getElementById('advanced-settings');
        settings.style.display = settings.style.display === 'none' ? 'block' : 'none';
    };

    async function loadFolders() {
        try {
            const res = await fetch('/api/folders');
            if (res.status === 401) return;
            const data = await res.json();
            if (data.folders && data.folders.length > 0) {
                folderSelect.innerHTML = data.folders.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
                // Note: container is now inside advanced-settings, which is hidden by default
            }
        } catch (e) {
            console.error("Failed to load folders", e);
        }
    }

    // Helper functions
    function addMessage(text, isUser, id = null) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isUser ? 'user-message' : 'ai-message'} fade-in`;
        if (id) msgDiv.id = id;

        let avatarHTML = isUser ? `<div class="avatar user-avatar"><i class="fas fa-user text-sm"></i></div>` : `<div class="avatar ai-avatar"><i class="fas fa-robot text-sm"></i></div>`;

        msgDiv.innerHTML = `${avatarHTML}<div class="bubble">${escapeHTML(text)}</div>`;
        chatMessages.appendChild(msgDiv);
        scrollToBottom();
    }

    function scrollToBottom() { chatMessages.scrollTop = chatMessages.scrollHeight; }
    function escapeHTML(str) {
        if (!str) return "";
        let div = document.createElement('div');
        div.innerText = str;
        return div.innerHTML;
    }

    // --- Admin Control Functions ---
    function initAdminControls() {
        const adminSection = document.getElementById('admin-control-section');
        const verifyBtn = document.getElementById('admin-verify-btn');
        const deployBtn = document.getElementById('admin-deploy-btn');
        const folderInput = document.getElementById('admin-folder-id');
        const folderNameDisplay = document.getElementById('admin-folder-name');
        const verifiedNameSpan = document.getElementById('verified-name');
        const emailsInput = document.getElementById('admin-emails');
        const statusMsg = document.getElementById('admin-status-msg');

        if (adminSection) adminSection.style.display = 'block';

        verifyBtn.addEventListener('click', async () => {
            const id = folderInput.value.trim();
            if (!id) return;

            verifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            try {
                const res = await fetch(`/api/admin/folder-name?id=${id}`);
                const data = await res.json();
                if (res.ok) {
                    folderNameDisplay.style.display = 'block';
                    verifiedNameSpan.textContent = data.name;
                    statusMsg.textContent = '';
                } else {
                    alert("Folder not found or access denied.");
                    folderNameDisplay.style.display = 'none';
                }
            } catch (e) {
                alert("Error verifying folder.");
            } finally {
                verifyBtn.innerHTML = '<i class="fas fa-check"></i>';
            }
        });

        deployBtn.addEventListener('click', async () => {
            const emails = emailsInput.value.trim();
            const folderId = folderInput.value.trim();

            if (!emails || !folderId) {
                alert("Please provide both folder ID and emails.");
                return;
            }

            deployBtn.disabled = true;
            deployBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deploying...';
            statusMsg.textContent = 'Sending invitations...';
            statusMsg.style.color = 'var(--text-secondary)';

            try {
                const res = await fetch('/api/admin/users/bulk-assign', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ emails, folderId })
                });
                const data = await res.json();

                if (res.ok) {
                    statusMsg.textContent = '✅ Deployment Successful!';
                    statusMsg.style.color = 'var(--success-color)';
                    emailsInput.value = '';
                    loadFolders(); // Refresh dropdown for admin
                } else {
                    statusMsg.textContent = `❌ Error: ${data.error}`;
                    statusMsg.style.color = 'var(--error-color)';
                }
            } catch (error) {
                statusMsg.textContent = '❌ Connection Error';
                statusMsg.style.color = 'var(--error-color)';
            } finally {
                deployBtn.disabled = false;
                deployBtn.innerHTML = 'Share Access & Invite';
            }
        });
    }
});

function sendSuggestion(text) {
    const input = document.getElementById('message-input');
    input.value = text;
    document.getElementById('chat-form').dispatchEvent(new Event('submit'));
}
