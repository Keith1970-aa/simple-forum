const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
const db = new sqlite3.Database('./forum.db'); // Automatically saves your data safely to a file

app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'simple-secret', resave: false, saveUninitialized: false }));

// Initialize database tables
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS threads (id INTEGER PRIMARY KEY, title TEXT, body TEXT, username TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS replies (id INTEGER PRIMARY KEY, body TEXT, thread_id INTEGER, username TEXT)");
});

// Layout shell for UI template
const view = (title, body, user) => `
<!DOCTYPE html>
<html>
<head>
    <title>${title}</title>
    <script src="https://jsdelivr.net"></script>
</head>
<body class="bg-gray-100 max-w-xl mx-auto p-6 text-sm">
    <nav class="flex justify-between items-center border-b pb-4 mb-6">
        <a href="/" class="text-xl font-bold text-blue-600">💬 MiniForum</a>
        <div>
            ${user ? `<b>${user}</b> | <a href="/logout" class="text-red-500">Logout</a>` : '<a href="/login" class="text-blue-500">Login</a> | <a href="/register" class="text-blue-500">Register</a>'}
        </div>
    </nav>
    <main>${body}</main>
</body>
</html>
`;

// 1. Thread List Feed
app.get('/', (req, res) => {
    db.all("SELECT * FROM threads ORDER BY id DESC", [], (err, threads) => {
        let content = req.session.user ? `<a href="/new" class="bg-blue-600 text-white px-3 py-1.5 rounded inline-block mb-6">+ New Thread</a>` : `<p class="mb-4 text-gray-500">Log in to create threads or reply.</p>`;
        content += `<div class="space-y-3">` + (threads || []).map(t => `
            <div class="bg-white p-4 rounded shadow-sm border">
                <a href="/thread/${t.id}" class="text-lg font-semibold text-blue-600 hover:underline">${t.title}</a>
                <p class="text-gray-400 text-xs mt-1">By ${t.username}</p>
            </div>
        `).join('') + `</div>`;
        res.send(view('Home', content, req.session.user));
    });
});

// 2. Auth Actions
app.get('/register', (req, res) => res.send(view('Register', `<form action="/register" method="POST" class="space-y-3 bg-white p-4 rounded shadow-sm border"><h2 class="text-lg font-bold">Register</h2><input type="text" name="username" placeholder="Username" required class="w-full p-2 border rounded"><input type="password" name="password" placeholder="Password" required class="w-full p-2 border rounded"><button class="bg-blue-600 text-white px-4 py-2 rounded">Sign Up</button></form>`, req.session.user)));
app.post('/register', async (req, res) => {
    try {
        const hashed = await bcrypt.hash(req.body.password, 10);
        db.run("INSERT INTO users (username, password) VALUES (?, ?)", [req.body.username, hashed], () => res.redirect('/login'));
    } catch(e) { res.redirect('/register'); }
});

app.get('/login', (req, res) => res.send(view('Login', `<form action="/login" method="POST" class="space-y-3 bg-white p-4 rounded shadow-sm border"><h2 class="text-lg font-bold">Login</h2><input type="text" name="username" placeholder="Username" required class="w-full p-2 border rounded"><input type="password" name="password" placeholder="Password" required class="w-full p-2 border rounded"><button class="bg-blue-600 text-white px-4 py-2 rounded">Log In</button></form>`, req.session.user)));
app.post('/login', (req, res) => {
    db.get("SELECT * FROM users WHERE username = ?", [req.body.username], async (err, user) => {
        if (user && await bcrypt.compare(req.body.password, user.password)) req.session.user = user.username;
        res.redirect('/');
    });
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// 3. Thread Management
app.get('/new', (req, res) => !req.session.user ? res.redirect('/login') : res.send(view('New Thread', `<form action="/new" method="POST" class="space-y-3 bg-white p-4 rounded shadow-sm border"><h2 class="text-lg font-bold">New Post</h2><input type="text" name="title" placeholder="Title" required class="w-full p-2 border rounded"><textarea name="body" placeholder="Content details..." required class="w-full p-2 border rounded" rows="4"></textarea><button class="bg-blue-600 text-white px-4 py-2 rounded">Publish</button></form>`, req.session.user)));
app.post('/new', (req, res) => {
    if (!req.session.user) return res.sendStatus(403);
    db.run("INSERT INTO threads (title, body, username) VALUES (?, ?, ?)", [req.body.title, req.body.body, req.session.user], function() { res.redirect(`/thread/${this.lastID}`); });
});

// 4. View Thread & Replies
app.get('/thread/:id', (req, res) => {
    db.get("SELECT * FROM threads WHERE id = ?", [req.params.id], (err, t) => {
        if (!t) return res.sendStatus(404);
        db.all("SELECT * FROM replies WHERE thread_id = ?", [t.id], (err, replies) => {
            let content = `
                <div class="bg-white p-5 rounded shadow-sm border mb-6">
                    <h1 class="text-xl font-bold mb-2">${t.title}</h1>
                    <p class="text-gray-700 whitespace-pre-wrap">${t.body}</p>
                    <p class="text-gray-400 text-xs mt-4">Posted by ${t.username}</p>
                </div>
                <h3 class="font-bold text-gray-600 mb-2">Replies (${(replies || []).length})</h3>
                <div class="space-y-2 mb-6">` + (replies || []).map(r => `<div class="bg-white p-3 rounded shadow-sm border text-xs"><p class="text-gray-700">${r.body}</p><p class="text-gray-400 mt-1">By ${r.username}</p></div>`).join('') + `</div>`;
            
            if (req.session.user) {
                content += `<form action="/thread/${t.id}/reply" method="POST" class="space-y-2"><textarea name="body" placeholder="Write a reply..." required class="w-full p-2 border rounded" rows="2"></textarea><button class="bg-blue-600 text-white px-3 py-1 rounded">Post Reply</button></form>`;
            }
            res.send(view(t.title, content, req.session.user));
        });
    });
});

app.post('/thread/:id/reply', (req, res) => {
    if (!req.session.user) return res.sendStatus(403);
    db.run("INSERT INTO replies (body, thread_id, username) VALUES (?, ?, ?)", [req.body.body, req.params.id, req.session.user], () => res.redirect(`/thread/${req.params.id}`));
});

app.listen(3000, () => console.log('Running on http://localhost:3000'));
