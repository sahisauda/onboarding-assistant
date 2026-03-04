const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'users.json');

// Initial default admin (user can change this in .env or via first login)
const MASTER_ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

function loadDB() {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ users: {} }, null, 2));
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

    if (!db.users[email]) {
        db.users[email] = {
            email: email,
            role: (isFirstUser || isExplicitAdmin) ? 'admin' : 'employee',
            allowedFolders: [],
            lastLogin: new Date().toISOString()
        };
        saveDB(db);
    } else {
        // Update last login
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

module.exports = { getUser, getAllUsers, updateUser, bulkAssign };
