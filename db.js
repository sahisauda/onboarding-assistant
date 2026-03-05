const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'users.json');

// Domain that is allowed to access the chatbot without any manual permission setup.
// Every @ranosys.com Google login is automatically granted access to the default Drive folder.
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || 'ranosys.com';
const MASTER_ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

// Returns true if the email belongs to the allowed company domain
function isAllowedDomain(email) {
    return email && email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

function loadDB() {
    if (!fs.existsSync(DB_PATH)) {
        const templatePath = path.join(__dirname, 'users.json');
        if (DB_PATH !== templatePath && fs.existsSync(templatePath)) {
            console.log(`Initializing persistent DB from template: ${templatePath} -> ${DB_PATH}`);
            fs.copyFileSync(templatePath, DB_PATH);
        } else {
            fs.writeFileSync(DB_PATH, JSON.stringify({ users: {} }, null, 2));
        }
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function getUser(email) {
    const db = loadDB();
    const isFirstUser = Object.keys(db.users).length === 0;
    const isExplicitAdmin = MASTER_ADMIN_EMAIL && email === MASTER_ADMIN_EMAIL;

    // Default folder: assigned automatically to every new Ranosys employee
    const defaultFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!db.users[email]) {
        // Auto-register: any ranosys.com employee gets access on first login
        const defaultFolders = (defaultFolderId && isAllowedDomain(email))
            ? [defaultFolderId]
            : [];

        db.users[email] = {
            email: email,
            role: (isFirstUser || isExplicitAdmin) ? 'admin' : 'employee',
            allowedFolders: defaultFolders,
            lastLogin: new Date().toISOString(),
            autoProvisioned: true
        };
        console.log(`Auto-provisioned new user: ${email} with folders: ${JSON.stringify(defaultFolders)}`);
        saveDB(db);
    } else {
        // Existing user: ensure the default folder is present (in case it was added later)
        if (defaultFolderId && isAllowedDomain(email)) {
            if (!db.users[email].allowedFolders.includes(defaultFolderId)) {
                db.users[email].allowedFolders.push(defaultFolderId);
            }
        }
        db.users[email].lastLogin = new Date().toISOString();
        saveDB(db);
    }
    return db.users[email];
}

function getAllUsers() {
    const db = loadDB();
    return Object.values(db.users);
}

function updateUser(email, updates) {
    const db = loadDB();
    if (!db.users[email]) {
        // Create user if they don't exist yet (pre-registration)
        db.users[email] = {
            email: email,
            role: 'employee',
            allowedFolders: [],
            lastLogin: 'Never'
        };
    }
    db.users[email] = { ...db.users[email], ...updates };
    saveDB(db);
    return db.users[email];
}

function bulkAssign(emails, folderId) {
    const db = loadDB();
    emails.forEach(email => {
        email = email.trim().toLowerCase();
        if (!email) return;

        if (!db.users[email]) {
            db.users[email] = {
                email: email,
                role: 'employee',
                allowedFolders: [],
                lastLogin: 'Never'
            };
        }

        if (!db.users[email].allowedFolders.includes(folderId)) {
            db.users[email].allowedFolders.push(folderId);
        }
    });
    saveDB(db);
}

module.exports = { getUser, getAllUsers, updateUser, bulkAssign, isAllowedDomain };
