import React, { useState, useEffect } from 'react';
import { Plus, X, LogOut, Trash2, Edit, MessageSquare, Send, Users, Download, Moon, Sun } from 'lucide-react';
import { db } from './firebase';
import { collection, doc, getDocs, setDoc, deleteDoc, onSnapshot, query } from 'firebase/firestore';

const formatHours = (h) => { const hrs = Math.floor(h); const mins = Math.round((h - hrs) * 60); return mins > 0 ? `${hrs}h${mins.toString().padStart(2, '0')}` : `${hrs}h`; };
const formatDate = (d) => { const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; };
const getWeekNumber = (d) => { const date = new Date(d); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7); const week1 = new Date(date.getFullYear(), 0, 4); return 1 + Math.round(((date - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7); };
const getWeekYear = (d) => { const date = new Date(d); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7); return date.getFullYear(); };
const getWeekDates = (year, week) => { const jan4 = new Date(year, 0, 4); const dow = jan4.getDay() || 7; const mon1 = new Date(jan4); mon1.setDate(jan4.getDate() - dow + 1); const mon = new Date(mon1); mon.setDate(mon1.getDate() + (week - 1) * 7); const fri = new Date(mon); fri.setDate(mon.getDate() + 4); const fmt = (d) => `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`; return `${fmt(mon)} au ${fmt(fri)}`; };
const formatWeekLabel = (k) => { const [y, w] = k.split('-S'); return `Semaine ${parseInt(w)} du ${getWeekDates(parseInt(y), parseInt(w))}`; };
const countPaniers = (entries) => new Set(entries.filter(e => e.category === 'panier').map(e => e.date)).size;
const calcTrajetSplit = (startTime, endTime) => {
    if (!startTime || !endTime) return { travail: 0, workhors: 0 };
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;

    // Plages de travail en minutes: 7h30-12h et 13h30-17h30
    const workRanges = [
        { start: 7 * 60 + 30, end: 12 * 60 },      // 7h30 - 12h00
        { start: 13 * 60 + 30, end: 17 * 60 + 30 } // 13h30 - 17h30
    ];

    let travailMin = 0;
    for (let min = startMin; min < endMin; min++) {
        const inWork = workRanges.some(r => min >= r.start && min < r.end);
        if (inWork) travailMin++;
    }

    const totalMin = endMin - startMin;
    const horsMin = totalMin - travailMin;

    return {
        travail: travailMin / 60,
        hors: horsMin / 60
    };
};

const themes = {
    dark: { bg: '#181c24', card: '#353b4a', btn: '#bfa76a', btnText: '#353b4a', border: '#bfa76a', accent: '#bfa76a', text: '#f5f5f5', textMuted: '#f5f5f5cc' },
    light: { bg: '#f5f5f5', card: '#ffffff', btn: '#bfa76a', btnText: '#353b4a', border: '#bfa76a', accent: '#bfa76a', text: '#353b4a', textMuted: '#353b4acc' }
};

const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

export default function TimesheetApp() {
    const [currentUser, setCurrentUser] = useState(null);
    const [users, setUsers] = useState([]);
    const [projects, setProjects] = useState([]);
    const [timeEntries, setTimeEntries] = useState([]);
    const [messages, setMessages] = useState([]);
    const [showAddProject, setShowAddProject] = useState(false);
    const [showAddEntry, setShowAddEntry] = useState(false);
    const [showMessages, setShowMessages] = useState(false);
    const [editingEntry, setEditingEntry] = useState(null);
    const [newProject, setNewProject] = useState({ name: '', client: '', estimatedAtelierHours: '', estimatedPoseHours: '' });
    const [showSignup, setShowSignup] = useState(false);
    const [userToDelete, setUserToDelete] = useState(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [darkMode, setDarkMode] = useState(true);
    const [loading, setLoading] = useState(true);
    const t = darkMode ? themes.dark : themes.light;

    useEffect(() => {
        const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
            setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoading(false);
        });
        const unsubProjects = onSnapshot(collection(db, 'projects'), (snap) => {
            setProjects(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        const unsubEntries = onSnapshot(collection(db, 'timeEntries'), (snap) => {
            setTimeEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        const unsubMessages = onSnapshot(collection(db, 'messages'), (snap) => {
            setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        return () => { unsubUsers(); unsubProjects(); unsubEntries(); unsubMessages(); };
    }, []);

    const handleAddProject = async () => {
        if (newProject.name && newProject.client) {
            const id = Date.now().toString();
            const p = { client: newProject.client, name: newProject.name, estimatedAtelierHours: parseFloat(newProject.estimatedAtelierHours) || 0, estimatedPoseHours: parseFloat(newProject.estimatedPoseHours) || 0, estimatedHours: (parseFloat(newProject.estimatedAtelierHours) || 0) + (parseFloat(newProject.estimatedPoseHours) || 0), createdBy: currentUser.id };
            await setDoc(doc(db, 'projects', id), p);
            setNewProject({ name: '', client: '', estimatedAtelierHours: '', estimatedPoseHours: '' }); setShowAddProject(false);
        }
    };

    const handleSaveEntry = async (entryData) => {
        if (entryData.checkPanierDuplicate && timeEntries.find(e => e.userId === currentUser.id && e.date === entryData.date && e.category === 'panier')) { alert('Un panier existe déjà pour cette date'); return; }
        const { checkPanierDuplicate, ...clean } = entryData;
        const entry = { ...clean, userId: currentUser.id, userName: currentUser.name };
        const id = editingEntry ? entry.id : Date.now().toString();
        delete entry.id;
        await setDoc(doc(db, 'timeEntries', id), entry);
        if (editingEntry) { setEditingEntry(null); setShowAddEntry(false); }
    };

    const handleDeleteEntry = async (id) => { await deleteDoc(doc(db, 'timeEntries', id)); };
    const handleEditEntry = (e) => { setEditingEntry(e); setShowAddEntry(true); };

    const handleDeleteProject = async (id) => {
        await deleteDoc(doc(db, 'projects', id));
        const entriesToDelete = timeEntries.filter(e => e.projectId === id);
        for (const e of entriesToDelete) { await deleteDoc(doc(db, 'timeEntries', e.id)); }
    };

    const handleDeleteClient = async (clientName) => {
        const clientProjects = projects.filter(p => p.client === clientName);
        for (const p of clientProjects) { await deleteDoc(doc(db, 'projects', p.id)); }
        const clientProjectIds = clientProjects.map(p => p.id);
        const entriesToDelete = timeEntries.filter(e => clientProjectIds.includes(e.projectId) || e.clientName === clientName);
        for (const e of entriesToDelete) { await deleteDoc(doc(db, 'timeEntries', e.id)); }
    };

    const handleSendMessage = async (msg) => {
        const id = Date.now().toString();
        await setDoc(doc(db, 'messages', id), { ...msg, timestamp: new Date().toISOString(), read: false });
    };

    const handleMarkAsRead = async (id) => {
        const msg = messages.find(m => m.id === id);
        if (msg) await setDoc(doc(db, 'messages', id), { ...msg, read: true });
    };

    const handleSignup = async (d) => {
        const id = Date.now().toString();
        await setDoc(doc(db, 'users', id), d);
        setShowSignup(false);
        alert('Compte créé !');
    };

    const handleDeleteUser = (id) => { setUserToDelete(id); setShowDeleteConfirm(true); };

    const confirmDeleteUser = async () => {
        if (!userToDelete) return;
        await deleteDoc(doc(db, 'users', userToDelete));
        const entriesToDelete = timeEntries.filter(e => e.userId === userToDelete);
        for (const e of entriesToDelete) { await deleteDoc(doc(db, 'timeEntries', e.id)); }
        const msgsToDelete = messages.filter(m => m.fromUserId === userToDelete || m.toUserId === userToDelete);
        for (const m of msgsToDelete) { await deleteDoc(doc(db, 'messages', m.id)); }
        setShowDeleteConfirm(false);
        setUserToDelete(null);
    };

    const getUnreadCount = () => currentUser ? messages.filter(m => m.toUserId === currentUser.id && !m.read).length : 0;
    const getClients = () => [...new Set(projects.map(p => p.client))].sort();

    if (loading) return <div style={{ backgroundColor: t.bg }} className="min-h-screen flex items-center justify-center"><p style={{ color: t.accent }} className="text-xl">Chargement...</p></div>;

    if (!currentUser) return showSignup ? <SignupScreen onSignup={handleSignup} onBack={() => setShowSignup(false)} users={users} darkMode={darkMode} setDarkMode={setDarkMode} t={t} /> : <LoginScreen onLogin={setCurrentUser} onSignup={() => setShowSignup(true)} users={users} darkMode={darkMode} setDarkMode={setDarkMode} t={t} />;

    return (
        <div style={{ backgroundColor: t.bg, minHeight: '100vh' }}>
            <header style={{ backgroundColor: t.card, borderBottom: `2px solid ${t.border}` }} className="shadow-md">
                <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
                    <h1 style={{ color: t.accent }} className="text-2xl font-bold">{currentUser.name}</h1>
                    <div className="flex items-center space-x-4">
                        <button onClick={() => setDarkMode(!darkMode)} style={{ backgroundColor: t.btn, color: t.btnText }} className="p-2 rounded-lg">{darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}</button>
                        {(currentUser.role === 'employee' || currentUser.role === 'rh') && <button onClick={() => setShowMessages(true)} className="relative" style={{ color: t.text }}><MessageSquare className="w-6 h-6" />{getUnreadCount() > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">{getUnreadCount()}</span>}</button>}
                        <button onClick={() => setCurrentUser(null)} className="flex items-center" style={{ color: t.text }}><LogOut className="w-5 h-5 mr-2" />Déconnexion</button>
                    </div>
                </div>
            </header>
            <main className="max-w-7xl mx-auto px-4 py-8">
                {currentUser.role === 'employee' && <EmployeeView currentUser={currentUser} timeEntries={timeEntries} projects={projects} onDelete={handleDeleteEntry} onEdit={handleEditEntry} onAdd={() => { setEditingEntry(null); setShowAddEntry(true); }} t={t} />}
                {currentUser.role === 'chef' && <ChefAtelierView currentUser={currentUser} timeEntries={timeEntries} projects={projects} onDelete={handleDeleteEntry} onEdit={handleEditEntry} onAdd={() => { setEditingEntry(null); setShowAddEntry(true); }} t={t} />}

                {currentUser.role === 'rh' && <RHView timeEntries={timeEntries} users={users} onDeleteUser={handleDeleteUser} t={t} />}
                {currentUser.role === 'patron' && <PatronView timeEntries={timeEntries} projects={projects} onAddProject={() => setShowAddProject(true)} onDeleteProject={handleDeleteProject} onDeleteClient={handleDeleteClient} onDeleteEntry={handleDeleteEntry} onDeleteUser={handleDeleteUser} users={users} currentUser={currentUser} t={t} />}
            </main>
            {showAddProject && <AddProjectModal onClose={() => setShowAddProject(false)} onAdd={handleAddProject} project={newProject} setProject={setNewProject} clients={getClients()} t={t} />}
            {showAddEntry && <AddEntryModal onClose={() => { setShowAddEntry(false); setEditingEntry(null); }} onSave={handleSaveEntry} editing={editingEntry} date={new Date().toISOString().split('T')[0]} projects={projects} t={t} timeEntries={timeEntries} currentUserId={currentUser.id} />}
            {showMessages && <MessagesModal currentUser={currentUser} messages={messages} users={users} onClose={() => setShowMessages(false)} onSend={handleSendMessage} onRead={handleMarkAsRead} t={t} />}
            {showDeleteConfirm && <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"><div style={{ backgroundColor: t.card, border: `2px solid ${t.border}` }} className="rounded-lg p-6 w-full max-w-md"><h3 style={{ color: t.accent }} className="text-xl font-bold mb-4">Confirmer la suppression</h3><p style={{ color: t.text }} className="mb-6">Supprimer cet utilisateur et toutes ses données ?</p><div className="flex space-x-3"><button onClick={() => { setShowDeleteConfirm(false); setUserToDelete(null); }} style={{ backgroundColor: t.bg, color: t.text, border: `1px solid ${t.border}` }} className="flex-1 py-2 rounded-lg">Annuler</button><button onClick={confirmDeleteUser} className="flex-1 bg-red-600 text-white py-2 rounded-lg">Supprimer</button></div></div></div>}
        </div>
    );
}

function LoginScreen({ onLogin, onSignup, users, darkMode, setDarkMode, t }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const tryLogin = () => { const u = users.find(u => u.name === username && u.password === password); if (u) onLogin(u); else alert('Identifiants incorrects'); };
    return (
        <div style={{ backgroundColor: t.bg }} className="min-h-screen flex items-center justify-center p-4">
            <div style={{ backgroundColor: t.card, border: `2px solid ${t.border}` }} className="rounded-2xl shadow-2xl p-8 w-full max-w-md">
                <div className="flex justify-end mb-4"><button onClick={() => setDarkMode(!darkMode)} style={{ backgroundColor: t.btn, color: t.btnText }} className="p-2 rounded-lg">{darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}</button></div>
                <h1 style={{ color: t.accent }} className="text-3xl font-bold text-center mb-6">Suivi des Heures</h1>
                <div className="space-y-4">
                    <div><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Nom</label><input type="text" value={username} onChange={e => setUsername(e.target.value)} onKeyPress={e => e.key === 'Enter' && tryLogin()} style={{ backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text }} className="w-full px-4 py-2 rounded-lg" /></div>
                    <div><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Mot de passe</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyPress={e => e.key === 'Enter' && tryLogin()} style={{ backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text }} className="w-full px-4 py-2 rounded-lg" /></div>
                    <button onClick={tryLogin} style={{ backgroundColor: t.btn, color: t.btnText }} className="w-full py-3 rounded-lg font-semibold">Se connecter</button>
                    <button onClick={onSignup} style={{ backgroundColor: 'transparent', color: t.accent, border: `2px solid ${t.border}` }} className="w-full py-3 rounded-lg font-semibold">Créer un compte</button>
                </div>
            </div>
        </div>
    );
}

function SignupScreen({ onSignup, onBack, users, darkMode, setDarkMode, t }) {
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [role, setRole] = useState('employee');
    const [error, setError] = useState('');

    const hasPatron = users.some(u => u.role === 'patron');
    const hasRH = users.some(u => u.role === 'rh');
    const hasChef = users.some(u => u.role === 'chef');

    const create = () => {
        setError('');
        if (!name || !password) { setError('Remplir tous les champs'); return; }
        if (password !== confirmPassword) { setError('Les mots de passe ne correspondent pas'); return; }
        if (password.length < 4) { setError('Mot de passe trop court (min 4 caractères)'); return; }
        if (users.find(u => u.name === name)) { setError('Ce nom existe déjà'); return; }
        if (role === 'patron' && hasPatron) { setError('Un patron existe déjà'); return; }
        if (role === 'rh' && hasRH) { setError('Un RH existe déjà'); return; }
        if (role === 'chef' && hasChef) { setError('Un chef d\'atelier existe déjà'); return; }
        onSignup({ name, password, role });
    };

    return (
        <div style={{ backgroundColor: t.bg }} className="min-h-screen flex items-center justify-center p-4">
            <div style={{ backgroundColor: t.card, border: `2px solid ${t.border}` }} className="rounded-2xl shadow-2xl p-8 w-full max-w-md">
                <div className="flex justify-end mb-4"><button onClick={() => setDarkMode(!darkMode)} style={{ backgroundColor: t.btn, color: t.btnText }} className="p-2 rounded-lg">{darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}</button></div>
                <h1 style={{ color: t.accent }} className="text-3xl font-bold text-center mb-6">Créer un compte</h1>
                <div className="space-y-4">
                    <div><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Nom</label><input type="text" value={name} onChange={e => setName(e.target.value)} style={{ backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text }} className="w-full px-4 py-2 rounded-lg" /></div>
                    <div><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Mot de passe</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} style={{ backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text }} className="w-full px-4 py-2 rounded-lg" /></div>
                    <div><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Confirmer mot de passe</label><input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} style={{ backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text }} className="w-full px-4 py-2 rounded-lg" /></div>
                    <div><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Rôle</label>
                        <select value={role} onChange={e => setRole(e.target.value)} style={{ backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text }} className="w-full px-4 py-2 rounded-lg">
                            <option value="employee">Employé</option>
                            {!hasRH && <option value="rh">RH</option>}
                            {!hasChef && <option value="chef">Chef d'atelier</option>}
                            {!hasPatron && <option value="patron">Patron</option>}
                        </select>
                    </div>
                    {error && <div className="bg-red-500/20 text-red-400 px-4 py-2 rounded-lg text-sm border border-red-500">{error}</div>}
                    <button onClick={create} style={{ backgroundColor: t.btn, color: t.btnText }} className="w-full py-3 rounded-lg font-semibold">Créer</button>
                    <button onClick={onBack} style={{ backgroundColor: 'transparent', color: t.accent, border: `2px solid ${t.border}` }} className="w-full py-3 rounded-lg font-semibold">Retour</button>
                </div>
            </div>
        </div>
    );
}

function AddProjectModal({ onClose, onAdd, project, setProject, clients, t }) {
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div style={{ backgroundColor: t.card, border: `2px solid ${t.border}` }} className="rounded-lg p-6 w-full max-w-md">
                <div className="flex justify-between items-center mb-4"><h3 style={{ color: t.accent }} className="text-xl font-bold">Nouveau projet</h3><button onClick={onClose} style={{ color: t.text }}><X className="w-6 h-6" /></button></div>
                <div className="space-y-4">
                    <div><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Client</label><input type="text" list="cl" value={project.client} onChange={e => setProject({ ...project, client: e.target.value })} style={{ backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text }} className="w-full px-4 py-2 rounded-lg" /><datalist id="cl">{clients.map(c => <option key={c} value={c} />)}</datalist></div>
                    <div><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Nom du projet</label><input type="text" value={project.name} onChange={e => setProject({ ...project, name: e.target.value })} style={{ backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text }} className="w-full px-4 py-2 rounded-lg" /></div>
                    <div className="grid grid-cols-2 gap-4">
                        <div><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Heures atelier</label><input type="number" step="0.5" value={project.estimatedAtelierHours || ''} onChange={e => setProject({ ...project, estimatedAtelierHours: e.target.value })} style={{ backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text }} className="w-full px-4 py-2 rounded-lg" /></div>
                        <div><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Heures pose</label><input type="number" step="0.5" value={project.estimatedPoseHours || ''} onChange={e => setProject({ ...project, estimatedPoseHours: e.target.value })} style={{ backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text }} className="w-full px-4 py-2 rounded-lg" /></div>
                    </div>
                    <button onClick={onAdd} style={{ backgroundColor: t.btn, color: t.btnText }} className="w-full py-2 rounded-lg font-semibold">Créer</button>
                </div>
            </div>
        </div>
    );
}

function AddEntryModal({ onClose, onSave, editing, date: initDate, projects, t, timeEntries, currentUserId }) {
    const [client, setClient] = useState('');
    const [startH, setStartH] = useState('');
    const [startM, setStartM] = useState('');
    const [endH, setEndH] = useState('');
    const [endM, setEndM] = useState('');
    const [cat, setCat] = useState('');
    const [subCat, setSubCat] = useState('');
    const [projectId, setProjectId] = useState('');
    const [desc, setDesc] = useState('');
    const [extra, setExtra] = useState(false);
    const [date, setDate] = useState(initDate);
    const [confirm, setConfirm] = useState(false);
    const [error, setError] = useState('');

    const start = startH && startM !== '' ? `${startH}:${startM.toString().padStart(2, '0')}` : '';
    const end = endH && endM !== '' ? `${endH}:${endM.toString().padStart(2, '0')}` : '';
    const atelierSubCats = ['Débit', 'CN', 'Montage', 'Nettoyage', 'Vernis', 'Chargement', 'Autres'];

    useEffect(() => {
        if (editing) {
            setDate(editing.date);
            setCat(editing.category); setSubCat(editing.subCategory || ''); setProjectId(editing.projectId || ''); setDesc(editing.description || ''); setExtra(editing.isExtra || false);
            if (editing.startTime) { const [h, m] = editing.startTime.split(':'); setStartH(h); setStartM(m); }
            if (editing.endTime) { const [h, m] = editing.endTime.split(':'); setEndH(h); setEndM(m); }
            if (editing.projectId) { const p = projects.find(p => p.id === editing.projectId); if (p) setClient(p.client); }
            if (editing.clientName && !editing.projectId) setClient(editing.clientName);
        }
    }, [editing, projects]);

    const byClient = projects.reduce((a, p) => { if (!a[p.client]) a[p.client] = []; a[p.client].push(p); return a; }, {});
    const clients = Object.keys(byClient).sort();
    const clientProjects = client ? byClient[client] : [];
    const hours = (() => { if (start && end) { const [sh, sm] = start.split(':').map(Number); const [eh, em] = end.split(':').map(Number); const diff = (eh * 60 + em) - (sh * 60 + sm); if (diff > 0) { const h = Math.floor(diff / 60); const m = diff % 60; return { dec: (diff / 60).toFixed(2), disp: m > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${h}h` }; } } return { dec: '', disp: '' }; })();

    const checkOverlap = () => {
        if (!start || !end || !date) return false;
        const newStart = parseInt(startH) * 60 + parseInt(startM);
        const newEnd = parseInt(endH) * 60 + parseInt(endM);
        const dayEntries = timeEntries.filter(e => e.userId === currentUserId && e.date === date && e.category !== 'panier' && e.id !== editing?.id);
        for (const e of dayEntries) {
            if (!e.startTime || !e.endTime) continue;
            const [sh, sm] = e.startTime.split(':').map(Number);
            const [eh, em] = e.endTime.split(':').map(Number);
            const eStart = sh * 60 + sm;
            const eEnd = eh * 60 + em;
            if (newStart < eEnd && newEnd > eStart) return true;
        }
        return false;
    };

    const addEntry = () => {
        setError('');
        if (!cat || !hours.dec || parseFloat(hours.dec) <= 0) { setError('Remplir tous les champs'); return; }
        if (cat === 'atelier' && !subCat) { setError('Sélectionner une sous-catégorie'); return; }
        if (checkOverlap()) { setError('Ces heures chevauchent une entrée existante'); return; }
        onSave({ id: editing?.id || Date.now().toString(), date, category: cat, subCategory: cat === 'atelier' ? subCat : null, projectId: projectId || null, clientName: client || null, hours: parseFloat(hours.dec), startTime: start, endTime: end, description: desc, isExtra: extra });
        if (!editing) { setStartH(''); setStartM(''); setEndH(''); setEndM(''); setClient(''); setCat(''); setSubCat(''); setProjectId(''); setDesc(''); setExtra(false); }
    };
    const [showPanierConfirm, setShowPanierConfirm] = useState(false);
    const addPanier = () => { setShowPanierConfirm(true); };
    const confirmPanier = () => { onSave({ id: Date.now().toString(), date, category: 'panier', projectId: null, hours: 0, startTime: '', endTime: '', description: 'Indemnité panier', isExtra: false, checkPanierDuplicate: true }); setShowPanierConfirm(false); };
    const inp = { backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text };
    const hoursOpts = Array.from({ length: 24 }, (_, i) => i);
    const minsOpts = [0, 15, 30, 45];

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
            <div style={{ backgroundColor: t.card, border: `2px solid ${t.border}` }} className="rounded-lg p-6 w-full max-w-2xl my-8">
                <div className="flex justify-between items-center mb-4"><h3 style={{ color: t.accent }} className="text-xl font-bold">{editing ? 'Modifier' : 'Ajouter'} des heures</h3><button onClick={onClose} style={{ color: t.text }}><X className="w-6 h-6" /></button></div>
                <div className="space-y-4">
                    <div><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Date</label><input type="date" value={date} max={new Date().toISOString().split('T')[0]} onChange={e => setDate(e.target.value)} style={inp} className="w-full px-4 py-2 rounded-lg" /></div>
                    {!editing && <div style={{ backgroundColor: t.bg, border: `2px solid ${t.border}` }} className="p-4 rounded-lg"><button onClick={addPanier} style={{ backgroundColor: t.btn, color: t.btnText }} className="w-full py-2 rounded-lg font-semibold">+ Ajouter panier</button></div>}
                    <div style={{ borderTop: `1px solid ${t.border}` }} className="pt-4">
                        <div className="grid grid-cols-5 gap-2">
                            <div className="col-span-2"><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Début</label><div className="flex gap-1"><select value={startH} onChange={e => setStartH(e.target.value)} style={inp} className="flex-1 px-1 py-2 rounded-lg text-sm"><option value="">HH</option>{hoursOpts.map(h => <option key={h} value={h.toString().padStart(2, '0')}>{h.toString().padStart(2, '0')}</option>)}</select><select value={startM} onChange={e => setStartM(e.target.value)} style={inp} className="flex-1 px-1 py-2 rounded-lg text-sm"><option value="">MM</option>{minsOpts.map(m => <option key={m} value={m.toString().padStart(2, '0')}>{m.toString().padStart(2, '0')}</option>)}</select></div></div>
                            <div className="col-span-2"><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Fin</label><div className="flex gap-1"><select value={endH} onChange={e => setEndH(e.target.value)} style={inp} className="flex-1 px-1 py-2 rounded-lg text-sm"><option value="">HH</option>{hoursOpts.map(h => <option key={h} value={h.toString().padStart(2, '0')}>{h.toString().padStart(2, '0')}</option>)}</select><select value={endM} onChange={e => setEndM(e.target.value)} style={inp} className="flex-1 px-1 py-2 rounded-lg text-sm"><option value="">MM</option>{minsOpts.map(m => <option key={m} value={m.toString().padStart(2, '0')}>{m.toString().padStart(2, '0')}</option>)}</select></div></div>
                            <div className="col-span-1"><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Durée</label><input type="text" value={hours.disp} readOnly style={{ backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.accent }} className="w-full px-1 py-2 rounded-lg font-bold text-sm text-center" /></div>
                        </div>
                        {error && <div className="mt-2 bg-red-500/20 text-red-400 px-4 py-2 rounded-lg text-sm border border-red-500">{error}</div>}
                        <div className="mt-4"><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Catégorie</label> <select value={cat} onChange={e => { setCat(e.target.value); setSubCat(''); }} style={inp} className="w-full px-4 py-2 rounded-lg"><option value="">Sélectionner</option><option value="trajet">Trajet</option><option value="pose">Pose</option><option value="atelier">Atelier</option><option value="bureau">Bureau</option></select> </div>
                        {cat === 'atelier' && <div className="mt-4"><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Sous-catégorie</label><select value={subCat} onChange={e => setSubCat(e.target.value)} style={inp} className="w-full px-4 py-2 rounded-lg"><option value="">Sélectionner</option>{atelierSubCats.map(s => <option key={s} value={s}>{s}</option>)}</select></div>}

                        {(cat === 'pose' || cat === 'atelier' || cat === 'trajet') && <div className="mt-4"><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Client</label><select value={client} onChange={e => { setClient(e.target.value); setProjectId(''); }} style={inp} className="w-full px-4 py-2 rounded-lg"><option value="">-- Aucun --</option>{clients.map(c => <option key={c} value={c}>{c}</option>)}</select></div>}
                        {client && cat !== 'trajet' && <div className="mt-4"><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Projet</label><select value={projectId} onChange={e => setProjectId(e.target.value)} style={inp} className="w-full px-4 py-2 rounded-lg"><option value="">-- Aucun --</option>{clientProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>}

                        <div className="mt-4"><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Description</label><textarea value={desc} onChange={e => setDesc(e.target.value)} style={inp} className="w-full px-4 py-2 rounded-lg" rows="2" /></div>
                        <div className="flex space-x-4 mt-6">{editing ? <button onClick={addEntry} style={{ backgroundColor: t.btn, color: t.btnText }} className="flex-1 py-2 rounded-lg font-semibold">Mettre à jour</button> : <><button onClick={addEntry} style={{ backgroundColor: t.btn, color: t.btnText }} className="flex-1 py-2 rounded-lg font-semibold">+ Ajouter</button><button onClick={onClose} style={{ backgroundColor: 'transparent', color: t.accent, border: `2px solid ${t.border}` }} className="flex-1 py-2 rounded-lg font-semibold">Terminer</button></>}</div>
                    </div>
                </div>
            </div>
            {showPanierConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div style={{ backgroundColor: t.card, border: `2px solid ${t.border}` }} className="rounded-lg p-6 w-full max-w-sm">
                        <h3 style={{ color: t.accent }} className="text-xl font-bold mb-4">Confirmer le panier</h3>
                        <p style={{ color: t.text }} className="mb-6">Ajouter un panier pour le {formatDate(date)} ?</p>
                        <div className="flex space-x-3">
                            <button onClick={() => setShowPanierConfirm(false)} style={{ backgroundColor: t.bg, color: t.text, border: `1px solid ${t.border}` }} className="flex-1 py-2 rounded-lg">Annuler</button>
                            <button onClick={confirmPanier} style={{ backgroundColor: t.btn, color: t.btnText }} className="flex-1 py-2 rounded-lg font-semibold">Confirmer</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
function ChefAtelierView({ currentUser, timeEntries, projects, onDelete, onEdit, onAdd, t }) {
    const [view, setView] = useState('heures');
    const [confirmDelete, setConfirmDelete] = useState(null);
    const [selectedWeek, setSelectedWeek] = useState('all');
    const [selectedProject, setSelectedProject] = useState('');
    const [selectedClient, setSelectedClient] = useState('all');

    const myEntries = timeEntries.filter(e => e.userId === currentUser.id);
    const weeks = [...new Set(myEntries.map(e => `${getWeekYear(e.date)}-S${getWeekNumber(e.date)}`))].sort().reverse();
    const filteredEntries = selectedWeek === 'all' ? myEntries : myEntries.filter(e => `${getWeekYear(e.date)}-S${getWeekNumber(e.date)}` === selectedWeek);
    const byDate = filteredEntries.reduce((a, e) => { if (!a[e.date]) a[e.date] = []; a[e.date].push(e); return a; }, {});
    const dates = Object.keys(byDate).sort().reverse();
    const total = filteredEntries.reduce((s, e) => s + e.hours, 0);
    const paniers = countPaniers(filteredEntries);
    const totalAtelier = filteredEntries.filter(e => e.category === 'atelier').reduce((s, e) => s + e.hours, 0);
    const totalPose = filteredEntries.filter(e => e.category === 'pose').reduce((s, e) => s + e.hours, 0);
    const totalTrajet = filteredEntries.filter(e => e.category === 'trajet').reduce((s, e) => s + e.hours, 0);

    const allAtelierEntries = timeEntries.filter(e => e.category === 'atelier' && e.subCategory !== 'Vernis');
    const allVernisEntries = timeEntries.filter(e => e.category === 'atelier' && e.subCategory === 'Vernis');
    const allPoseEntries = timeEntries.filter(e => e.category === 'pose');

    const getProjectStats = (projectId) => {
        const p = projects.find(pr => pr.id === projectId);
        if (!p) return null;
        const atelierHours = allAtelierEntries.filter(e => e.projectId === projectId).reduce((s, e) => s + e.hours, 0);
        const vernisHours = allVernisEntries.filter(e => e.projectId === projectId).reduce((s, e) => s + e.hours, 0);
        const poseHours = allPoseEntries.filter(e => e.projectId === projectId).reduce((s, e) => s + e.hours, 0);
        return { ...p, atelierHours, vernisHours, poseHours };
    };

    const projectsWithStats = projects.map(p => getProjectStats(p.id)).filter(Boolean);
    const clients = [...new Set(projects.map(p => p.client))].sort();

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 style={{ color: t.accent }} className="text-2xl font-bold">Chef d'atelier</h2>
                <div className="flex gap-2">
                    <button onClick={() => setView('heures')} style={{ backgroundColor: view === 'heures' ? t.btn : t.bg, color: view === 'heures' ? t.btnText : t.text, border: `2px solid ${t.border}` }} className="px-4 py-2 rounded-lg font-semibold">Mes heures</button>
                    <button onClick={() => setView('projets')} style={{ backgroundColor: view === 'projets' ? t.btn : t.bg, color: view === 'projets' ? t.btnText : t.text, border: `2px solid ${t.border}` }} className="px-4 py-2 rounded-lg font-semibold">Vue projets</button>
                </div>
            </div>

            {view === 'heures' && (
                <>
                    <div className="flex justify-end">
                        <button onClick={onAdd} style={{ backgroundColor: t.btn, color: t.btnText }} className="flex items-center px-4 py-2 rounded-lg font-semibold"><Plus className="w-5 h-5 mr-2" />Ajouter</button>
                    </div>
                    <div>
                        <label style={{ color: t.text }} className="block text-sm font-medium mb-2">Semaine</label>
                        <select value={selectedWeek} onChange={e => setSelectedWeek(e.target.value)} style={{ backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text }} className="w-full px-4 py-2 rounded-lg">
                            <option value="all">Toutes les semaines</option>
                            {weeks.map(w => <option key={w} value={w}>{formatWeekLabel(w)}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={{ color: t.text }} className="block text-sm font-medium mb-2">Voir un projet</label>
                        <select onChange={e => setSelectedProject(e.target.value)} value={selectedProject} style={{ backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text }} className="w-full px-4 py-2 rounded-lg">
                            <option value="">-- Sélectionner un projet --</option>
                            {projects.map(p => <option key={p.id} value={p.id}>{p.client} - {p.name}</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }} className="p-6 rounded-lg">
                            <p style={{ color: t.textMuted }} className="mb-2">Total heures</p>
                            <p style={{ color: t.accent }} className="text-2xl font-bold">{formatHours(total)}</p>
                            <div className="mt-2 text-sm">
                                <p style={{ color: t.textMuted }}>Atelier: <span style={{ color: t.text }}>{formatHours(totalAtelier)}</span></p>
                                <p style={{ color: t.textMuted }}>Pose: <span style={{ color: t.text }}>{formatHours(totalPose)}</span></p>
                                <p style={{ color: t.textMuted }}>Trajet: <span style={{ color: t.text }}>{formatHours(totalTrajet)}</span></p>
                            </div>
                        </div>
                        <div style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }} className="p-6 rounded-lg">
                            <p style={{ color: t.textMuted }}>Paniers</p>
                            <p style={{ color: t.accent }} className="text-3xl font-bold">{paniers}</p>
                        </div>
                    </div>
                    <div className="space-y-4">
                        {dates.map(d => {
                            const dayEntries = byDate[d];
                            const dayTotal = dayEntries.reduce((s, e) => s + e.hours, 0);
                            const hasPanier = dayEntries.some(e => e.category === 'panier');
                            return (
                                <div key={d} style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }} className="rounded-lg p-4">
                                    <div className="mb-3"><h3 style={{ color: t.accent }} className="font-bold text-lg">{formatDate(d)}</h3><p style={{ color: t.textMuted }} className="text-sm">{formatHours(dayTotal)}{hasPanier && ' 🍽️'}</p></div>
                                    <div className="space-y-2">
                                        {dayEntries.map(e => {
                                            const proj = e.projectId ? projects.find(p => p.id === e.projectId) : null;
                                            return (
                                                <div key={e.id} style={{ backgroundColor: t.bg, border: `1px solid ${t.border}` }} className="flex justify-between items-start p-3 rounded">
                                                    <div className="flex-1">
                                                        <div className="flex items-center space-x-2"><span style={{ color: t.text }} className="font-semibold capitalize">{e.category}{e.subCategory ? ` - ${e.subCategory}` : ''}</span>{e.category !== 'panier' && <span style={{ color: t.textMuted }}>{e.startTime} - {e.endTime} ({formatHours(e.hours)})</span>}</div>
                                                        {proj ? <p style={{ color: t.textMuted }} className="text-sm mt-1">{proj.client} - {proj.name}</p> : e.clientName && <p style={{ color: t.textMuted }} className="text-sm mt-1">{e.clientName}</p>}
                                                        {e.description && <p style={{ color: t.textMuted }} className="text-sm mt-1">{e.description}</p>}
                                                    </div>
                                                    <div className="flex space-x-4 ml-4"><button onClick={() => onEdit(e)} style={{ color: t.accent }}><Edit className="w-5 h-5" /></button><button onClick={() => setConfirmDelete(e.id)} className="text-red-500"><Trash2 className="w-5 h-5" /></button></div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {view === 'projets' && (
                <div className="space-y-4">
                    <div>
                        <label style={{ color: t.text }} className="block text-sm font-medium mb-2">Client</label>
                        <select value={selectedClient} onChange={e => setSelectedClient(e.target.value)} style={{ backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text }} className="w-full px-4 py-2 rounded-lg">
                            <option value="all">Tous les clients</option>
                            {clients.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    {projectsWithStats.filter(p => selectedClient === 'all' || p.client === selectedClient).map(p => (
                        <div key={p.id} style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }} className="rounded-lg p-4">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 style={{ color: t.accent }} className="text-lg font-bold">{p.client}</h3>
                                    <p style={{ color: t.textMuted }}>{p.name}</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-4 text-sm">
                                <div style={{ backgroundColor: t.bg, border: `1px solid ${t.border}` }} className="p-3 rounded text-center">
                                    <p style={{ color: t.accent }} className="font-semibold">Atelier</p>
                                    <p style={{ color: t.text }} className="font-bold">{formatHours(p.atelierHours)}</p>
                                </div>
                                <div style={{ backgroundColor: t.bg, border: `1px solid ${t.border}` }} className="p-3 rounded text-center">
                                    <p style={{ color: '#f97316' }} className="font-semibold">Vernis</p>
                                    <p style={{ color: t.text }} className="font-bold">{formatHours(p.vernisHours)}</p>
                                </div>
                                <div style={{ backgroundColor: t.bg, border: `1px solid ${t.border}` }} className="p-3 rounded text-center">
                                    <p style={{ color: '#22c55e' }} className="font-semibold">Pose</p>
                                    <p style={{ color: t.text }} className="font-bold">{formatHours(p.poseHours)}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {selectedProject && (() => {
                const p = projects.find(pr => pr.id === selectedProject);
                if (!p) return null;
                const projectEntries = timeEntries.filter(e => e.projectId === p.id);
                const atelierDone = projectEntries.filter(e => e.category === 'atelier').reduce((s, e) => s + e.hours, 0);
                const poseDone = projectEntries.filter(e => e.category === 'pose').reduce((s, e) => s + e.hours, 0);
                const atelierPct = (p.estimatedAtelierHours || 0) > 0 ? (atelierDone / p.estimatedAtelierHours) * 100 : 0;
                const posePct = (p.estimatedPoseHours || 0) > 0 ? (poseDone / p.estimatedPoseHours) * 100 : 0;
                return (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                        <div style={{ backgroundColor: t.card, border: `2px solid ${t.border}` }} className="rounded-lg p-6 w-full max-w-md">
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h3 style={{ color: t.accent }} className="text-xl font-bold">{p.name}</h3>
                                    <p style={{ color: t.textMuted }}>{p.client}</p>
                                </div>
                                <button onClick={() => setSelectedProject('')} style={{ color: t.text }}><X className="w-6 h-6" /></button>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <div className="flex justify-between mb-1">
                                        <span style={{ color: t.accent }} className="text-sm font-semibold">Atelier: {formatHours(atelierDone)} / {formatHours(p.estimatedAtelierHours || 0)}</span>
                                        <span style={{ color: (p.estimatedAtelierHours || 0) - atelierDone >= 0 ? '#22c55e' : '#ef4444' }} className="text-sm font-semibold">
                                            {(p.estimatedAtelierHours || 0) - atelierDone >= 0 ? 'Reste' : 'Dépassement'}: {formatHours(Math.abs((p.estimatedAtelierHours || 0) - atelierDone))}
                                        </span>
                                    </div>
                                    <div style={{ backgroundColor: t.bg }} className="h-3 rounded overflow-hidden">
                                        <div style={{ width: `${Math.min(atelierPct, 100)}%`, backgroundColor: atelierPct > 100 ? '#ef4444' : atelierPct > 80 ? '#eab308' : '#22c55e' }} className="h-full" />
                                    </div>
                                </div>
                                <div>
                                    <div className="flex justify-between mb-1">
                                        <span style={{ color: t.accent }} className="text-sm font-semibold">Pose: {formatHours(poseDone)} / {formatHours(p.estimatedPoseHours || 0)}</span>
                                        <span style={{ color: (p.estimatedPoseHours || 0) - poseDone >= 0 ? '#22c55e' : '#ef4444' }} className="text-sm font-semibold">
                                            {(p.estimatedPoseHours || 0) - poseDone >= 0 ? 'Reste' : 'Dépassement'}: {formatHours(Math.abs((p.estimatedPoseHours || 0) - poseDone))}
                                        </span>
                                    </div>
                                    <div style={{ backgroundColor: t.bg }} className="h-3 rounded overflow-hidden">
                                        <div style={{ width: `${Math.min(posePct, 100)}%`, backgroundColor: posePct > 100 ? '#ef4444' : posePct > 80 ? '#eab308' : '#22c55e' }} className="h-full" />
                                    </div>
                                </div>
                            </div>
                            <button onClick={() => setSelectedProject('')} style={{ backgroundColor: t.btn, color: t.btnText }} className="w-full py-2 rounded-lg font-semibold mt-6">Fermer</button>
                        </div>
                    </div>
                );
            })()}

            {confirmDelete && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div style={{ backgroundColor: t.card, border: `2px solid ${t.border}` }} className="rounded-lg p-6 w-full max-w-sm">
                        <h3 style={{ color: t.accent }} className="text-xl font-bold mb-4">Confirmer la suppression</h3>
                        <p style={{ color: t.text }} className="mb-6">Supprimer cette entrée ?</p>
                        <div className="flex space-x-3">
                            <button onClick={() => setConfirmDelete(null)} style={{ backgroundColor: t.bg, color: t.text, border: `1px solid ${t.border}` }} className="flex-1 py-2 rounded-lg">Annuler</button>
                            <button onClick={() => { onDelete(confirmDelete); setConfirmDelete(null); }} className="flex-1 bg-red-600 text-white py-2 rounded-lg">Supprimer</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
function EmployeeView({ currentUser, timeEntries, projects, onDelete, onEdit, onAdd, t }) {
    const [confirmDelete, setConfirmDelete] = useState(null);
    const [selectedWeek, setSelectedWeek] = useState('all');
    const [selectedProject, setSelectedProject] = useState('');
    const entries = timeEntries.filter(e => e.userId === currentUser.id);

    // Grouper par semaine
    const weeks = [...new Set(entries.map(e => `${getWeekYear(e.date)}-S${getWeekNumber(e.date)}`))].sort().reverse();

    // Filtrer par semaine sélectionnée
    const filteredEntries = selectedWeek === 'all'
        ? entries
        : entries.filter(e => `${getWeekYear(e.date)}-S${getWeekNumber(e.date)}` === selectedWeek);

    const byDate = filteredEntries.reduce((a, e) => { if (!a[e.date]) a[e.date] = []; a[e.date].push(e); return a; }, {});
    const dates = Object.keys(byDate).sort().reverse();
    const total = filteredEntries.reduce((s, e) => s + e.hours, 0);
    const paniers = countPaniers(filteredEntries);

    // Heures par catégorie
    const totalAtelier = filteredEntries.filter(e => e.category === 'atelier').reduce((s, e) => s + e.hours, 0);
    const totalPose = filteredEntries.filter(e => e.category === 'pose').reduce((s, e) => s + e.hours, 0);
    const totalTrajet = filteredEntries.filter(e => e.category === 'trajet').reduce((s, e) => s + e.hours, 0);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 style={{ color: t.accent }} className="text-2xl font-bold">Mes heures</h2>
                <button onClick={onAdd} style={{ backgroundColor: t.btn, color: t.btnText }} className="flex items-center px-4 py-2 rounded-lg font-semibold"><Plus className="w-5 h-5 mr-2" />Ajouter</button>
            </div>

            <div>
                <label style={{ color: t.text }} className="block text-sm font-medium mb-2">Semaine</label>
                <select value={selectedWeek} onChange={e => setSelectedWeek(e.target.value)} style={{ backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text }} className="w-full px-4 py-2 rounded-lg">
                    <option value="all">Toutes les semaines</option>
                    {weeks.map(w => <option key={w} value={w}>{formatWeekLabel(w)}</option>)}
                </select>
            </div>

            <div>
                <label style={{ color: t.text }} className="block text-sm font-medium mb-2">Voir un projet</label>
                <select onChange={e => setSelectedProject(e.target.value)} value={selectedProject} style={{ backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text }} className="w-full px-4 py-2 rounded-lg">
                    <option value="">-- Sélectionner un projet --</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.client} - {p.name}</option>)}
                </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }} className="p-6 rounded-lg">
                    <p style={{ color: t.textMuted }} className="mb-2">Total heures</p>
                    <p style={{ color: t.accent }} className="text-2xl font-bold">{formatHours(total)}</p>
                    <div className="mt-2 text-sm">
                        <p style={{ color: t.textMuted }}>Atelier: <span style={{ color: t.text }}>{formatHours(totalAtelier)}</span></p>
                        <p style={{ color: t.textMuted }}>Pose: <span style={{ color: t.text }}>{formatHours(totalPose)}</span></p>
                        <p style={{ color: t.textMuted }}>Trajet: <span style={{ color: t.text }}>{formatHours(totalTrajet)}</span></p>
                    </div>
                </div>
                <div style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }} className="p-6 rounded-lg">
                    <p style={{ color: t.textMuted }}>Paniers</p>
                    <p style={{ color: t.accent }} className="text-3xl font-bold">{paniers}</p>
                </div>
            </div>

            <div className="space-y-4">
                {dates.map(d => {
                    const dayEntries = byDate[d];
                    const dayTotal = dayEntries.reduce((s, e) => s + e.hours, 0);
                    const hasPanier = dayEntries.some(e => e.category === 'panier');
                    return (
                        <div key={d} style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }} className="rounded-lg p-4">
                            <div className="mb-3"><h3 style={{ color: t.accent }} className="font-bold text-lg">{formatDate(d)}</h3><p style={{ color: t.textMuted }} className="text-sm">{formatHours(dayTotal)}{hasPanier && ' 🍽️'}</p></div>
                            <div className="space-y-2">
                                {dayEntries.map(e => {
                                    const proj = e.projectId ? projects.find(p => p.id === e.projectId) : null;
                                    return (
                                        <div key={e.id} style={{ backgroundColor: t.bg, border: `1px solid ${t.border}` }} className="flex justify-between items-start p-3 rounded">
                                            <div className="flex-1">
                                                <div className="flex items-center space-x-2"><span style={{ color: t.text }} className="font-semibold capitalize">{e.category}{e.subCategory ? ` - ${e.subCategory}` : ''}</span>{e.category !== 'panier' && <span style={{ color: t.textMuted }}>{e.startTime} - {e.endTime} ({formatHours(e.hours)})</span>}</div>
                                                {proj ? <p style={{ color: t.textMuted }} className="text-sm mt-1">{proj.client} - {proj.name}</p> : e.clientName && <p style={{ color: t.textMuted }} className="text-sm mt-1">{e.clientName}</p>}
                                                {e.description && <p style={{ color: t.textMuted }} className="text-sm mt-1">{e.description}</p>}
                                            </div>
                                            <div className="flex space-x-4 ml-4"><button onClick={() => onEdit(e)} style={{ color: t.accent }}><Edit className="w-5 h-5" /></button><button onClick={() => setConfirmDelete(e.id)} className="text-red-500"><Trash2 className="w-5 h-5" /></button></div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {selectedProject && (() => {
                const p = projects.find(pr => pr.id === selectedProject);
                if (!p) return null;
                const projectEntries = timeEntries.filter(e => e.projectId === p.id);
                const atelierDone = projectEntries.filter(e => e.category === 'atelier').reduce((s, e) => s + e.hours, 0);
                const poseDone = projectEntries.filter(e => e.category === 'pose').reduce((s, e) => s + e.hours, 0);
                const atelierPct = (p.estimatedAtelierHours || 0) > 0 ? (atelierDone / p.estimatedAtelierHours) * 100 : 0;
                const posePct = (p.estimatedPoseHours || 0) > 0 ? (poseDone / p.estimatedPoseHours) * 100 : 0;
                return (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                        <div style={{ backgroundColor: t.card, border: `2px solid ${t.border}` }} className="rounded-lg p-6 w-full max-w-md">
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h3 style={{ color: t.accent }} className="text-xl font-bold">{p.name}</h3>
                                    <p style={{ color: t.textMuted }}>{p.client}</p>
                                </div>
                                <button onClick={() => setSelectedProject('')} style={{ color: t.text }}><X className="w-6 h-6" /></button>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <div className="flex justify-between mb-1">
                                        <span style={{ color: t.accent }} className="text-sm font-semibold">Atelier: {formatHours(atelierDone)} / {formatHours(p.estimatedAtelierHours || 0)}</span>
                                        <span style={{ color: (p.estimatedAtelierHours || 0) - atelierDone >= 0 ? '#22c55e' : '#ef4444' }} className="text-sm font-semibold">
                                            {(p.estimatedAtelierHours || 0) - atelierDone >= 0 ? 'Reste' : 'Dépassement'}: {formatHours(Math.abs((p.estimatedAtelierHours || 0) - atelierDone))}
                                        </span>
                                    </div>
                                    <div style={{ backgroundColor: t.bg }} className="h-3 rounded overflow-hidden">
                                        <div style={{ width: `${Math.min(atelierPct, 100)}%`, backgroundColor: atelierPct > 100 ? '#ef4444' : atelierPct > 80 ? '#eab308' : '#22c55e' }} className="h-full" />
                                    </div>
                                </div>
                                <div>
                                    <div className="flex justify-between mb-1">
                                        <span style={{ color: t.accent }} className="text-sm font-semibold">Pose: {formatHours(poseDone)} / {formatHours(p.estimatedPoseHours || 0)}</span>
                                        <span style={{ color: (p.estimatedPoseHours || 0) - poseDone >= 0 ? '#22c55e' : '#ef4444' }} className="text-sm font-semibold">
                                            {(p.estimatedPoseHours || 0) - poseDone >= 0 ? 'Reste' : 'Dépassement'}: {formatHours(Math.abs((p.estimatedPoseHours || 0) - poseDone))}
                                        </span>
                                    </div>
                                    <div style={{ backgroundColor: t.bg }} className="h-3 rounded overflow-hidden">
                                        <div style={{ width: `${Math.min(posePct, 100)}%`, backgroundColor: posePct > 100 ? '#ef4444' : posePct > 80 ? '#eab308' : '#22c55e' }} className="h-full" />
                                    </div>
                                </div>
                            </div>
                            <button onClick={() => setSelectedProject('')} style={{ backgroundColor: t.btn, color: t.btnText }} className="w-full py-2 rounded-lg font-semibold mt-6">Fermer</button>
                        </div>
                    </div>
                );
            })()}

            {confirmDelete && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div style={{ backgroundColor: t.card, border: `2px solid ${t.border}` }} className="rounded-lg p-6 w-full max-w-sm">
                        <h3 style={{ color: t.accent }} className="text-xl font-bold mb-4">Confirmer la suppression</h3>
                        <p style={{ color: t.text }} className="mb-6">Supprimer cette entrée ?</p>
                        <div className="flex space-x-3">
                            <button onClick={() => setConfirmDelete(null)} style={{ backgroundColor: t.bg, color: t.text, border: `1px solid ${t.border}` }} className="flex-1 py-2 rounded-lg">Annuler</button>
                            <button onClick={() => { onDelete(confirmDelete); setConfirmDelete(null); }} className="flex-1 bg-red-600 text-white py-2 rounded-lg">Supprimer</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function RHView({ timeEntries, users, onDeleteUser, t }) {
    const [week, setWeek] = useState('all');
    const [emp, setEmp] = useState('all');
    const [showMgmt, setShowMgmt] = useState(false);
    const employees = users.filter(u => u.role === 'employee');
    const weeks = [...new Set(timeEntries.map(e => `${getWeekYear(e.date)}-S${getWeekNumber(e.date)}`))].sort().reverse();
    let filtered = timeEntries;
    if (week !== 'all') filtered = filtered.filter(e => `${getWeekYear(e.date)}-S${getWeekNumber(e.date)}` === week);
    if (emp !== 'all') filtered = filtered.filter(e => e.userId === emp);
    const stats = Object.values(filtered.reduce((a, e) => { if (!a[e.userId]) a[e.userId] = { name: e.userName, trajet: 0, pose: 0, atelier: 0, paniers: 0, total: 0 }; if (e.category === 'panier') a[e.userId].paniers++; else { a[e.userId][e.category] += e.hours; a[e.userId].total += e.hours; } return a; }, {}));

    const genPDF = async () => {
        if (emp === 'all' || week === 'all') { alert('Sélectionnez un employé et une semaine'); return; }
        const s = document.createElement('script');
        s.src = JSPDF_URL;
        document.head.appendChild(s);
        await new Promise(r => s.onload = r);
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const bgColor = [24, 28, 36];
        const cardColor = [53, 59, 74];
        const accentColor = [191, 167, 106];
        const textColor = [245, 245, 245];
        doc.setFillColor(...bgColor);
        doc.rect(0, 0, 210, 297, 'F');
        let y = 20;
        const employee = employees.find(e => e.id === emp);
        const empEntries = filtered.filter(e => e.userId === emp);

        // Titre
        doc.setTextColor(...accentColor);
        doc.setFontSize(18); doc.setFont(undefined, 'bold');
        doc.text(`Fiche : ${employee?.name}`, 14, y); y += 12;
        doc.setTextColor(...textColor);
        doc.setFontSize(12); doc.setFont(undefined, 'normal');
        doc.text(formatWeekLabel(week), 14, y); y += 8;
        doc.text(`Édité le ${new Date().toLocaleDateString('fr-FR')}`, 14, y); y += 12;

        // Grouper par date
        const byDate = empEntries.reduce((a, e) => { if (!a[e.date]) a[e.date] = []; a[e.date].push(e); return a; }, {});
        const dates = Object.keys(byDate).sort();

        // Pour chaque jour
        dates.forEach(date => {
            const dayEntries = byDate[date].sort((a, b) => a.startTime?.localeCompare(b.startTime));
            const dayTotal = dayEntries.reduce((s, e) => s + e.hours, 0);
            const dayPaniers = dayEntries.filter(e => e.category === 'panier').length;

            // Nouvelle page si besoin
            if (y > 240) { doc.addPage(); y = 20; doc.setFillColor(...bgColor); doc.rect(0, 0, 210, 297, 'F'); }

            // En-tête du jour
            doc.setFillColor(...cardColor); doc.rect(10, y - 5, 190, 10, 'F');
            doc.setTextColor(...accentColor);
            doc.setFontSize(12); doc.setFont(undefined, 'bold');
            doc.text(`${formatDate(date)}`, 14, y);
            doc.text(`Total : ${formatHours(dayTotal)}${dayPaniers > 0 ? ' (panier)' : ''}`, 150, y);
            y += 12;

            // Entrées du jour
            doc.setFontSize(10); doc.setFont(undefined, 'normal');
            dayEntries.forEach(e => {
                if (y > 270) { doc.addPage(); y = 20; doc.setFillColor(...bgColor); doc.rect(0, 0, 210, 297, 'F'); }

                if (e.category === 'panier') {
                    doc.setTextColor(...accentColor);
                    doc.text(`  Panier`, 14, y); y += 6;
                } else {
                    const color = e.category === 'trajet' ? [59, 130, 246] : e.category === 'pose' ? [34, 197, 94] : [249, 115, 22];
                    doc.setTextColor(...color);
                    doc.text(`  Action : ${e.category}${e.subCategory ? ' - ' + e.subCategory : ''}`, 14, y); y += 6;
                    doc.setTextColor(...textColor);
                    doc.text(`  Début : ${e.startTime}    Fin : ${e.endTime}    Durée : ${formatHours(e.hours)}`, 14, y); y += 6;

                    // Détail trajets
                    if (e.category === 'trajet') {
                        const split = calcTrajetSplit(e.startTime, e.endTime);
                        doc.setTextColor(34, 197, 94);
                        doc.text(`      Temps de travail : ${formatHours(split.travail)}`, 14, y); y += 5;
                        doc.setTextColor(249, 115, 22);
                        doc.text(`      Hors temps de travail : ${formatHours(split.hors)}`, 14, y); y += 6;
                    }
                }
                y += 2;
            });
            y += 4;
        });

        // Total semaine
        if (y > 240) { doc.addPage(); y = 20; doc.setFillColor(...bgColor); doc.rect(0, 0, 210, 297, 'F'); }
        const weekTotal = empEntries.reduce((s, e) => s + e.hours, 0);
        const weekPaniers = empEntries.filter(e => e.category === 'panier').length;

        // Calcul totaux trajets
        const trajets = empEntries.filter(e => e.category === 'trajet');
        const trajetTotals = trajets.reduce((acc, e) => {
            const split = calcTrajetSplit(e.startTime, e.endTime);
            return { travail: acc.travail + split.travail, hors: acc.hors + split.hors };
        }, { travail: 0, hors: 0 });

        doc.setFillColor(...accentColor); doc.rect(10, y, 190, 12, 'F');
        doc.setTextColor(...bgColor);
        doc.setFontSize(14); doc.setFont(undefined, 'bold');
        doc.text(`Total semaine : ${formatHours(weekTotal)}${weekPaniers > 0 ? '   ' + weekPaniers + ' panier(s)' : ''}`, 14, y + 8);
        y += 18;

        // Détail trajets semaine
        if (trajets.length > 0) {
            doc.setTextColor(...textColor);
            doc.setFontSize(11); doc.setFont(undefined, 'bold');
            doc.text('Détail trajets semaine :', 14, y); y += 7;
            doc.setFont(undefined, 'normal');
            doc.setTextColor(34, 197, 94);
            doc.text(`Temps de travail : ${formatHours(trajetTotals.travail)}`, 14, y); y += 6;
            doc.setTextColor(249, 115, 22);
            doc.text(`Hors temps de travail : ${formatHours(trajetTotals.hors)}`, 14, y);
        }

        doc.save(`Fiche_${employee?.name}_${week.split('-S')[1]}_${week.split('-S')[0]}.pdf`);
    };

    const inp = { backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text };
    return (
        <div className="space-y-6">
            <div className="flex justify-end"><button onClick={() => setShowMgmt(!showMgmt)} style={{ backgroundColor: t.btn, color: t.btnText }} className="flex items-center px-4 py-2 rounded-lg font-semibold"><Users className="w-5 h-5 mr-2" />Gérer</button></div>
            {showMgmt && <div style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }} className="rounded-lg p-6"><h3 style={{ color: t.accent }} className="text-xl font-bold mb-4">Employés</h3><div className="space-y-3">{employees.map(u => <div key={u.id} style={{ backgroundColor: t.bg, border: `1px solid ${t.border}` }} className="flex justify-between items-center p-4 rounded-lg"><p style={{ color: t.text }} className="font-semibold">{u.name}</p><button onClick={() => onDeleteUser(u.id)} className="bg-red-600 text-white px-4 py-2 rounded-lg flex items-center"><Trash2 className="w-4 h-4 mr-2" />Supprimer</button></div>)}</div></div>}
            <div className="grid grid-cols-3 gap-4">
                <div><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Employé</label><select value={emp} onChange={e => setEmp(e.target.value)} style={inp} className="w-full px-4 py-2 rounded-lg"><option value="all">Tous</option>{employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
                <div><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Semaine</label><select value={week} onChange={e => setWeek(e.target.value)} style={inp} className="w-full px-4 py-2 rounded-lg"><option value="all">Toutes</option>{weeks.map(w => <option key={w} value={w}>{formatWeekLabel(w)}</option>)}</select></div>
                <div className="flex items-end"><button onClick={genPDF} disabled={emp === 'all' || week === 'all'} style={emp === 'all' || week === 'all' ? { backgroundColor: '#666', color: '#999' } : { backgroundColor: t.btn, color: t.btnText }} className="flex items-center px-4 py-2 rounded-lg font-semibold"><Download className="w-5 h-5 mr-2" />PDF</button></div>
            </div>
            <div style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }} className="rounded-lg overflow-hidden">
                <table className="w-full"><thead style={{ backgroundColor: t.bg }}><tr>{['Employé', 'Trajet', 'Pose', 'Atelier', 'Paniers', 'Total'].map(h => <th key={h} style={{ color: t.textMuted }} className="px-6 py-3 text-left text-xs font-medium uppercase">{h}</th>)}</tr></thead><tbody>{stats.map((s, i) => <tr key={i} style={{ borderTop: `1px solid ${t.border}` }}><td style={{ color: t.accent }} className="px-6 py-4 font-medium">{s.name}</td><td style={{ color: t.text }} className="px-6 py-4">{formatHours(s.trajet)}</td><td style={{ color: t.text }} className="px-6 py-4">{formatHours(s.pose)}</td><td style={{ color: t.text }} className="px-6 py-4">{formatHours(s.atelier)}</td><td style={{ color: t.text }} className="px-6 py-4">{s.paniers}</td><td style={{ color: t.accent }} className="px-6 py-4 font-bold">{formatHours(s.total)}</td></tr>)}</tbody></table>
            </div>

            {emp !== 'all' && week !== 'all' && (() => {
                const empEntries = filtered.filter(e => e.userId === emp);
                const byDate = empEntries.reduce((a, e) => { if (!a[e.date]) a[e.date] = []; a[e.date].push(e); return a; }, {});
                const dates = Object.keys(byDate).sort();
                const weekTotal = empEntries.reduce((s, e) => s + e.hours, 0);
                const weekPaniers = empEntries.filter(e => e.category === 'panier').length;
                return (
                    <div style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }} className="rounded-lg p-6">
                        <h3 style={{ color: t.accent }} className="text-xl font-bold mb-4">Détail des heures</h3>
                        <div className="space-y-6">
                            {dates.map(date => {
                                const dayEntries = byDate[date].sort((a, b) => a.startTime?.localeCompare(b.startTime));
                                const dayTotal = dayEntries.reduce((s, e) => s + e.hours, 0);
                                const dayPaniers = dayEntries.filter(e => e.category === 'panier').length;
                                return (
                                    <div key={date}>
                                        <div className="flex justify-between items-center mb-3" style={{ borderBottom: `2px solid ${t.border}`, paddingBottom: '8px' }}>
                                            <h4 style={{ color: t.accent }} className="font-bold text-lg">{formatDate(date)}</h4>
                                            <div style={{ color: t.text }} className="text-right">
                                                <span className="font-bold">{formatHours(dayTotal)}</span>
                                                {dayPaniers > 0 && <span className="ml-2">🍽️</span>}
                                            </div>
                                        </div>
                                        <div className="space-y-3">
                                            {dayEntries.map(e => (
                                                <div key={e.id} style={{ backgroundColor: t.bg, border: `1px solid ${t.border}` }} className="p-4 rounded-lg">
                                                    <p style={{ color: t.text }}><span className="font-semibold">Action :</span> <span style={{ color: e.category === 'trajet' ? '#3b82f6' : e.category === 'pose' ? '#22c55e' : e.category === 'atelier' ? '#f97316' : t.text }}>{e.category}{e.subCategory ? ` - ${e.subCategory}` : ''}</span></p>
                                                    {e.category !== 'panier' && (
                                                        <>
                                                            <p style={{ color: t.text }}><span className="font-semibold">Début :</span> {e.startTime}</p>
                                                            <p style={{ color: t.text }}><span className="font-semibold">Fin :</span> {e.endTime}</p>
                                                            <p style={{ color: t.accent }}><span className="font-semibold">Durée :</span> {formatHours(e.hours)}</p>
                                                            {e.category === 'trajet' && (() => {
                                                                const split = calcTrajetSplit(e.startTime, e.endTime);
                                                                return (
                                                                    <div className="mt-2 pl-2" style={{ borderLeft: `2px solid ${t.border}` }}>
                                                                        <p style={{ color: '#22c55e' }}><span className="font-semibold">Temps de travail :</span> {formatHours(split.travail)}</p>
                                                                        <p style={{ color: '#f97316' }}><span className="font-semibold">Hors temps de travail :</span> {formatHours(split.hors)}</p>
                                                                    </div>
                                                                );
                                                            })()}
                                                        </>
                                                    )}
                                                    {e.category === 'panier' && <p style={{ color: t.accent }}>🍽️ Panier</p>}

                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="mt-6 pt-4" style={{ borderTop: `3px solid ${t.accent}` }}>
                            {(() => {
                                const trajets = empEntries.filter(e => e.category === 'trajet');
                                const trajetTotals = trajets.reduce((acc, e) => {
                                    const split = calcTrajetSplit(e.startTime, e.endTime);
                                    return { travail: acc.travail + split.travail, hors: acc.hors + split.hors };
                                }, { travail: 0, hors: 0 });
                                return (
                                    <>
                                        <div className="flex justify-between items-center mb-2">
                                            <span style={{ color: t.accent }} className="text-xl font-bold">Total semaine</span>
                                            <div className="text-right">
                                                <span style={{ color: t.accent }} className="text-2xl font-bold">{formatHours(weekTotal)}</span>
                                                {weekPaniers > 0 && <span style={{ color: t.text }} className="ml-3">{weekPaniers} 🍽️</span>}
                                            </div>
                                        </div>
                                        {trajets.length > 0 && (
                                            <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${t.border}` }}>
                                                <p style={{ color: t.textMuted }} className="font-semibold mb-1">Détail trajets :</p>
                                                <p style={{ color: '#22c55e' }}>Temps de travail : {formatHours(trajetTotals.travail)}</p>
                                                <p style={{ color: '#f97316' }}>Hors temps de travail : {formatHours(trajetTotals.hors)}</p>
                                            </div>
                                        )}
                                    </>
                                );
                            })()}
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

function PatronView({ timeEntries, projects, onAddProject, onDeleteProject, onDeleteClient, onDeleteEntry, onDeleteUser, users, currentUser, t }) {
    const [client, setClient] = useState('all');
    const [confirmDelete, setConfirmDelete] = useState(null);
    const [confirmDeleteTrajet, setConfirmDeleteTrajet] = useState(null);
    const [showMgmt, setShowMgmt] = useState(false);
    const managableUsers = users.filter(u => u.id !== currentUser.id);
    const clients = [...new Set(projects.map(p => p.client))].sort();
    const filtered = client === 'all' ? projects : projects.filter(p => p.client === client);
    const getDetails = (p) => { const e = timeEntries.filter(x => x.projectId === p.id); return { atelier: e.filter(x => x.category === 'atelier' && !x.isExtra).reduce((s, x) => s + x.hours, 0), pose: e.filter(x => x.category === 'pose' && !x.isExtra).reduce((s, x) => s + x.hours, 0), entries: e }; };
    const stats = filtered.map(p => { const d = getDetails(p); const bill = d.atelier + d.pose; return { ...p, ...d, bill, remain: (p.estimatedHours || 0) - bill, pct: (p.estimatedHours || 0) > 0 ? (bill / p.estimatedHours) * 100 : 0 }; });
    const clientExtras = {};
    const clientTrajets = {};
    clients.forEach(c => {
        clientExtras[c] = timeEntries.filter(x => x.isExtra && (projects.find(p => p.id === x.projectId)?.client === c || (!x.projectId && x.clientName === c))).reduce((s, x) => s + x.hours, 0);
        clientTrajets[c] = timeEntries.filter(x => x.category === 'trajet' && x.clientName === c).reduce((s, x) => s + x.hours, 0);
    });
    const totTrajet = Object.values(clientTrajets).reduce((s, v) => s + v, 0);
    const trajetsNonAttribues = timeEntries.filter(x => x.category === 'trajet' && !x.clientName);
    const totTrajetsNonAttribues = trajetsNonAttribues.reduce((s, x) => s + x.hours, 0);
    const totEst = filtered.reduce((s, p) => s + (p.estimatedAtelierHours || 0) + (p.estimatedPoseHours || 0), 0);
    const totBill = stats.reduce((s, p) => s + p.bill, 0);
    const totExtra = Object.values(clientExtras).reduce((s, v) => s + v, 0);

    const genPDF = async (type, id) => {
        const s = document.createElement('script');
        s.src = JSPDF_URL;
        document.head.appendChild(s);
        await new Promise(r => s.onload = r);
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const bgColor = [24, 28, 36];
        const cardColor = [53, 59, 74];
        const accentColor = [191, 167, 106];
        const textColor = [245, 245, 245];
        const blueColor = [59, 130, 246];
        const orangeColor = [249, 115, 22];
        doc.setFillColor(...bgColor);
        doc.rect(0, 0, 210, 297, 'F');
        let y = 20;
        const addSec = (entries, title) => {
            if (!entries.length) return;
            if (y > 260) { doc.addPage(); y = 20; doc.setFillColor(...bgColor); doc.rect(0, 0, 210, 297, 'F'); }
            doc.setTextColor(...accentColor);
            doc.setFontSize(14); doc.setFont(undefined, 'bold');
            doc.text(`${title} (${formatHours(entries.reduce((s, e) => s + e.hours, 0))})`, 14, y);
            y += 12;
            doc.setTextColor(...textColor);
            doc.setFontSize(11); doc.setFont(undefined, 'normal');
            entries.sort((a, b) => a.date.localeCompare(b.date)).forEach(e => {
                if (y > 280) { doc.addPage(); y = 20; doc.setFillColor(...bgColor); doc.rect(0, 0, 210, 297, 'F'); }
                doc.text(`  ${formatDate(e.date)} - ${e.startTime} à ${e.endTime} : ${formatHours(e.hours)}${e.description ? ' - ' + e.description : ''} (${e.userName})`, 14, y);
                y += 6;
            });
            y += 5;
        };
        if (type === 'client') {
            const cp = projects.filter(p => p.client === id);
            const clientExtraEntries = timeEntries.filter(x => x.isExtra && (projects.find(p => p.id === x.projectId)?.client === id || (!x.projectId && x.clientName === id)));
            doc.setTextColor(...accentColor);
            doc.setFontSize(18); doc.setFont(undefined, 'bold'); doc.text(`Bilan Client : ${id}`, 14, y); y += 12;
            doc.setTextColor(...textColor);
            doc.setFontSize(12); doc.setFont(undefined, 'normal'); doc.text(`Édité le ${new Date().toLocaleDateString('fr-FR')}`, 14, y); y += 16;
            const atelierSubCats = ['Débit', 'CN', 'Montage', 'Nettoyage', 'Vernis', 'Chargement', 'Autres'];
            cp.forEach(p => {
                const d = getDetails(p);
                if (y > 240) { doc.addPage(); y = 20; doc.setFillColor(...bgColor); doc.rect(0, 0, 210, 297, 'F'); }
                doc.setFillColor(...cardColor); doc.rect(10, y - 5, 190, 10, 'F');
                doc.setTextColor(...accentColor);
                doc.setFontSize(14); doc.setFont(undefined, 'bold'); doc.text(`Projet : ${p.name}`, 14, y); y += 12;
                doc.setTextColor(...textColor);
                doc.setFontSize(12); doc.setFont(undefined, 'normal');
                doc.text(`Prévues : Atelier ${formatHours(p.estimatedAtelierHours || 0)} / Pose ${formatHours(p.estimatedPoseHours || 0)} | Réalisées : ${formatHours(d.atelier + d.pose)}`, 14, y); y += 10;
                const atelierEntries = d.entries.filter(e => e.category === 'atelier' && !e.isExtra);
                if (atelierEntries.length > 0) {
                    addSec(atelierEntries, 'Atelier');
                    atelierSubCats.forEach(sub => {
                        const subEntries = atelierEntries.filter(e => e.subCategory === sub);
                        if (subEntries.length > 0) {
                            if (y > 280) { doc.addPage(); y = 20; doc.setFillColor(...bgColor); doc.rect(0, 0, 210, 297, 'F'); }
                            doc.setTextColor(...textColor);
                            doc.setFontSize(11); doc.setFont(undefined, 'italic');
                            doc.text(`    ${sub} : ${formatHours(subEntries.reduce((s, e) => s + e.hours, 0))}`, 14, y); y += 6;
                        }
                    });
                }
                addSec(d.entries.filter(e => e.category === 'pose' && !e.isExtra), 'Pose');
                y += 5;
            });
            const clientTrajetEntries = timeEntries.filter(x => x.category === 'trajet' && x.clientName === id);
            if (clientTrajetEntries.length > 0) {
                if (y > 240) { doc.addPage(); y = 20; doc.setFillColor(...bgColor); doc.rect(0, 0, 210, 297, 'F'); }
                doc.setFillColor(...blueColor); doc.rect(10, y - 5, 190, 10, 'F');
                doc.setTextColor(...bgColor);
                doc.setFontSize(14); doc.setFont(undefined, 'bold'); doc.text(`Trajets client (${formatHours(clientTrajetEntries.reduce((s, e) => s + e.hours, 0))})`, 14, y); y += 12;
                doc.setTextColor(...textColor);
                addSec(clientTrajetEntries, 'Détail');
            }
            if (clientExtraEntries.length > 0) {
                if (y > 240) { doc.addPage(); y = 20; doc.setFillColor(...bgColor); doc.rect(0, 0, 210, 297, 'F'); }
                doc.setFillColor(...orangeColor); doc.rect(10, y - 5, 190, 10, 'F');
                doc.setTextColor(...bgColor);
                doc.setFontSize(14); doc.setFont(undefined, 'bold'); doc.text(`Travaux supplémentaires client`, 14, y); y += 12;
                doc.setTextColor(...textColor);
                addSec(clientExtraEntries, 'Détail');
            }
            doc.save(`Bilan_${id}_${new Date().toISOString().split('T')[0]}.pdf`);
        } else {
            const p = projects.find(x => x.id === id);
            const d = getDetails(p);
            const clientExtraEntries = timeEntries.filter(x => x.isExtra && (projects.find(pr => pr.id === x.projectId)?.client === p.client || (!x.projectId && x.clientName === p.client)));
            doc.setTextColor(...accentColor);
            doc.setFontSize(18); doc.setFont(undefined, 'bold'); doc.text(`Bilan : ${p.name}`, 14, y); y += 12;
            doc.setTextColor(...textColor);
            doc.setFontSize(12); doc.setFont(undefined, 'normal'); doc.text(`Client : ${p.client}`, 14, y); y += 8;
            doc.text(`Édité le ${new Date().toLocaleDateString('fr-FR')}`, 14, y); y += 10;
            doc.text(`Prévues : Atelier ${formatHours(p.estimatedAtelierHours || 0)} / Pose ${formatHours(p.estimatedPoseHours || 0)} | Réalisées : Atelier ${formatHours(d.atelier)} / Pose ${formatHours(d.pose)}`, 14, y); y += 14;
            const atelierSubCats = ['Débit', 'CN', 'Montage', 'Nettoyage', 'Vernis', 'Chargement', 'Autres'];
            const atelierEntries = d.entries.filter(e => e.category === 'atelier' && !e.isExtra);
            if (atelierEntries.length > 0) {
                addSec(atelierEntries, 'Atelier');
                atelierSubCats.forEach(sub => {
                    const subEntries = atelierEntries.filter(e => e.subCategory === sub);
                    if (subEntries.length > 0) {
                        if (y > 280) { doc.addPage(); y = 20; doc.setFillColor(...bgColor); doc.rect(0, 0, 210, 297, 'F'); }
                        doc.setTextColor(...textColor);
                        doc.setFontSize(11); doc.setFont(undefined, 'italic');
                        doc.text(`    ${sub} : ${formatHours(subEntries.reduce((s, e) => s + e.hours, 0))}`, 14, y); y += 6;
                    }
                });
            }
            addSec(d.entries.filter(e => e.category === 'pose' && !e.isExtra), 'Pose');
            const clientTrajetEntries = timeEntries.filter(x => x.category === 'trajet' && x.clientName === p.client);
            if (clientTrajetEntries.length > 0) { addSec(clientTrajetEntries, 'Trajets client'); }
            if (clientExtraEntries.length > 0) { addSec(clientExtraEntries, 'Travaux sup client'); }
            doc.save(`Bilan_${p.client}_${p.name}_${new Date().toISOString().split('T')[0]}.pdf`);
        }
    };

    const inp = { backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text };
    return (
        <div className="space-y-6">
            <div className="flex justify-end gap-4">
                <button onClick={() => setShowMgmt(!showMgmt)} style={{ backgroundColor: t.btn, color: t.btnText }} className="flex items-center px-4 py-2 rounded-lg font-semibold"><Users className="w-5 h-5 mr-2" />Gérer</button>
                <button onClick={onAddProject} style={{ backgroundColor: t.btn, color: t.btnText }} className="flex items-center px-4 py-2 rounded-lg font-semibold"><Plus className="w-5 h-5 mr-2" />Nouveau projet</button>
            </div>
            {showMgmt && <div style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }} className="rounded-lg p-6"><h3 style={{ color: t.accent }} className="text-xl font-bold mb-4">Utilisateurs</h3><div className="space-y-3">{managableUsers.map(u => <div key={u.id} style={{ backgroundColor: t.bg, border: `1px solid ${t.border}` }} className="flex justify-between items-center p-4 rounded-lg"><div><p style={{ color: t.text }} className="font-semibold">{u.name}</p><p style={{ color: t.textMuted }} className="text-sm">{u.role === 'rh' ? 'RH' : 'Employé'}</p></div><button onClick={() => onDeleteUser(u.id)} className="bg-red-600 text-white px-4 py-2 rounded-lg flex items-center"><Trash2 className="w-4 h-4 mr-2" />Supprimer</button></div>)}</div></div>}
            <div className="flex items-end gap-4">
                <div className="flex-1"><label style={{ color: t.text }} className="block text-sm font-medium mb-2">Client</label><select value={client} onChange={e => setClient(e.target.value)} style={inp} className="w-full px-4 py-2 rounded-lg"><option value="all">Tous</option>{clients.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                {client !== 'all' && <button onClick={() => genPDF('client', client)} style={{ backgroundColor: t.btn, color: t.btnText }} className="flex items-center px-4 py-2 rounded-lg font-semibold"><Download className="w-5 h-5 mr-2" />PDF Client</button>}
                {client !== 'all' && <button onClick={() => setConfirmDelete({ type: 'client', id: client })} className="flex items-center px-4 py-2 rounded-lg font-semibold bg-red-600 text-white"><Trash2 className="w-5 h-5 mr-2" />Supprimer client</button>}
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }} className="p-6 rounded-lg">
                    <p style={{ color: t.textMuted }} className="mb-2">Heures prévues</p>
                    <p style={{ color: t.accent }}>Atelier: <span className="font-bold">{formatHours(filtered.reduce((s, p) => s + (p.estimatedAtelierHours || 0), 0))}</span></p>
                    <p style={{ color: t.accent }}>Pose: <span className="font-bold">{formatHours(filtered.reduce((s, p) => s + (p.estimatedPoseHours || 0), 0))}</span></p>
                </div>
                <div style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }} className="p-6 rounded-lg">
                    <p style={{ color: t.textMuted }} className="mb-2">Heures effectuées</p>
                    <p style={{ color: '#22c55e' }}>Atelier: <span className="font-bold">{formatHours(stats.reduce((s, p) => s + p.atelier, 0))}</span></p>
                    <p style={{ color: '#22c55e' }}>Pose: <span className="font-bold">{formatHours(stats.reduce((s, p) => s + p.pose, 0))}</span></p>
                </div>
            </div>
            <div className="space-y-4">
                {stats.map(p => (
                    <div key={p.id} style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }} className="rounded-lg p-6">
                        <div className="flex justify-between mb-4">
                            <div><h3 style={{ color: t.accent }} className="text-xl font-bold">{p.client}</h3><p style={{ color: t.textMuted }}>{p.name}</p></div>
                            <div className="flex items-start gap-4">
                                <div className="text-right"><p style={{ color: t.textMuted }} className="text-sm">Prévues: A {formatHours(p.estimatedAtelierHours || 0)} / P {formatHours(p.estimatedPoseHours || 0)}</p><p style={{ color: '#22c55e' }} className="text-lg font-bold">{formatHours(p.bill)}</p>{(clientExtras[p.client] || 0) > 0 && <p style={{ color: '#f97316' }} className="text-sm">+ {formatHours(clientExtras[p.client])} trav. sup</p>}</div>
                                <button onClick={() => genPDF('project', p.id)} style={{ backgroundColor: t.btn, color: t.btnText }} className="flex items-center px-3 py-2 rounded-lg text-sm font-semibold"><Download className="w-4 h-4 mr-1" />PDF</button>
                                <button onClick={() => setConfirmDelete({ type: 'project', id: p.id, name: p.name })} className="flex items-center px-3 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white"><Trash2 className="w-4 h-4" /></button>
                            </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2 mb-4 text-sm">{[{ l: 'Atelier', v: p.atelier }, { l: 'Pose', v: p.pose }, { l: 'Trajet', v: clientTrajets[p.client] || 0 }, { l: 'Trav. sup', v: clientExtras[p.client] || 0, c: '#f97316' }].map(x => <div key={x.l} style={{ backgroundColor: t.bg, border: `1px solid ${t.border}` }} className="p-2 rounded text-center"><p style={{ color: x.c || t.accent }} className="font-semibold">{x.l}</p><p style={{ color: t.text }} className="font-bold">{formatHours(x.v)}</p></div>)}</div>
                        <div className="space-y-3">
                            <div>
                                <div className="flex justify-between mb-1">
                                    <span style={{ color: t.accent }} className="text-xs font-semibold">Atelier: {formatHours(p.atelier)} / {formatHours(p.estimatedAtelierHours || 0)}</span>
                                    <span style={{ color: (p.estimatedAtelierHours || 0) - p.atelier >= 0 ? '#22c55e' : '#ef4444' }} className="text-xs font-semibold">
                                        {(p.estimatedAtelierHours || 0) - p.atelier >= 0 ? 'Reste' : 'Dépassement'}: {formatHours(Math.abs((p.estimatedAtelierHours || 0) - p.atelier))}
                                    </span>
                                </div>
                                <div style={{ backgroundColor: t.bg }} className="h-2 rounded overflow-hidden">
                                    <div style={{ width: `${Math.min((p.estimatedAtelierHours || 0) > 0 ? (p.atelier / p.estimatedAtelierHours) * 100 : 0, 100)}%`, backgroundColor: (p.estimatedAtelierHours || 0) > 0 && p.atelier / p.estimatedAtelierHours > 1 ? '#ef4444' : (p.estimatedAtelierHours || 0) > 0 && p.atelier / p.estimatedAtelierHours > 0.8 ? '#eab308' : '#22c55e' }} className="h-full" />
                                </div>
                            </div>
                            <div>
                                <div className="flex justify-between mb-1">
                                    <span style={{ color: t.accent }} className="text-xs font-semibold">Pose: {formatHours(p.pose)} / {formatHours(p.estimatedPoseHours || 0)}</span>
                                    <span style={{ color: (p.estimatedPoseHours || 0) - p.pose >= 0 ? '#22c55e' : '#ef4444' }} className="text-xs font-semibold">
                                        {(p.estimatedPoseHours || 0) - p.pose >= 0 ? 'Reste' : 'Dépassement'}: {formatHours(Math.abs((p.estimatedPoseHours || 0) - p.pose))}
                                    </span>
                                </div>
                                <div style={{ backgroundColor: t.bg }} className="h-2 rounded overflow-hidden">
                                    <div style={{ width: `${Math.min((p.estimatedPoseHours || 0) > 0 ? (p.pose / p.estimatedPoseHours) * 100 : 0, 100)}%`, backgroundColor: (p.estimatedPoseHours || 0) > 0 && p.pose / p.estimatedPoseHours > 1 ? '#ef4444' : (p.estimatedPoseHours || 0) > 0 && p.pose / p.estimatedPoseHours > 0.8 ? '#eab308' : '#22c55e' }} className="h-full" />
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            {trajetsNonAttribues.length > 0 && (
                <div style={{ backgroundColor: t.card, border: `1px solid ${t.border}` }} className="rounded-lg p-6">
                    <div className="flex justify-between items-center mb-4">
                        <div><h3 style={{ color: '#3b82f6' }} className="text-xl font-bold">Trajets non attribués</h3><p style={{ color: t.textMuted }}>Trajets sans client assigné</p></div>
                        <p style={{ color: '#3b82f6' }} className="text-2xl font-bold">{formatHours(totTrajetsNonAttribues)}</p>
                    </div>
                    <div className="space-y-2">
                        {trajetsNonAttribues.sort((a, b) => b.date.localeCompare(a.date)).map(e => (
                            <div key={e.id} style={{ backgroundColor: t.bg, border: `1px solid ${t.border}` }} className="p-3 rounded flex justify-between items-center">
                                <div>
                                    <span style={{ color: t.text }} className="font-semibold">{formatDate(e.date)}</span>
                                    <span style={{ color: t.textMuted }} className="ml-3">{e.startTime} - {e.endTime}</span>
                                    <span style={{ color: t.accent }} className="ml-3 font-semibold">{formatHours(e.hours)}</span>
                                    {e.description && <span style={{ color: t.textMuted }} className="ml-3">- {e.description}</span>}
                                </div>
                                <div className="flex items-center gap-4">
                                    <span style={{ color: t.textMuted }} className="text-sm">{e.userName}</span>
                                    <button onClick={() => setConfirmDeleteTrajet(e.id)} className="text-red-500 hover:text-red-400"><Trash2 className="w-5 h-5" /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {confirmDelete && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div style={{ backgroundColor: t.card, border: `2px solid ${t.border}` }} className="rounded-lg p-6 w-full max-w-md">
                        <h3 style={{ color: t.accent }} className="text-xl font-bold mb-4">Confirmer la suppression</h3>
                        <p style={{ color: t.text }} className="mb-6">{confirmDelete.type === 'client' ? `Supprimer le client "${confirmDelete.id}" et tous ses projets ?` : `Supprimer le projet "${confirmDelete.name}" ?`}</p>
                        <p style={{ color: '#f97316' }} className="mb-6 text-sm">⚠️ Toutes les heures associées seront également supprimées.</p>
                        <div className="flex space-x-3">
                            <button onClick={() => setConfirmDelete(null)} style={{ backgroundColor: t.bg, color: t.text, border: `1px solid ${t.border}` }} className="flex-1 py-2 rounded-lg">Annuler</button>
                            <button onClick={() => { if (confirmDelete.type === 'client') { onDeleteClient(confirmDelete.id); setClient('all'); } else { onDeleteProject(confirmDelete.id); } setConfirmDelete(null); }} className="flex-1 bg-red-600 text-white py-2 rounded-lg">Supprimer</button>
                        </div>
                    </div>
                </div>
            )}
            {confirmDeleteTrajet && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div style={{ backgroundColor: t.card, border: `2px solid ${t.border}` }} className="rounded-lg p-6 w-full max-w-md">
                        <h3 style={{ color: t.accent }} className="text-xl font-bold mb-4">Confirmer la suppression</h3>
                        <p style={{ color: t.text }} className="mb-6">Supprimer ce trajet ?</p>
                        <div className="flex space-x-3">
                            <button onClick={() => setConfirmDeleteTrajet(null)} style={{ backgroundColor: t.bg, color: t.text, border: `1px solid ${t.border}` }} className="flex-1 py-2 rounded-lg">Annuler</button>
                            <button onClick={() => { onDeleteEntry(confirmDeleteTrajet); setConfirmDeleteTrajet(null); }} className="flex-1 bg-red-600 text-white py-2 rounded-lg">Supprimer</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function MessagesModal({ currentUser, messages, users, onClose, onSend, onRead, t }) {
    const [msg, setMsg] = useState({ to: '', subject: '', content: '' });
    const [compose, setCompose] = useState(false);
    const userMsgs = messages.filter(m => m.toUserId === currentUser.id || m.fromUserId === currentUser.id).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const available = currentUser.role === 'rh' ? users.filter(u => u.role === 'employee') : users.filter(u => u.role === 'rh');
    const send = () => { if (msg.to && msg.subject && msg.content) { onSend({ fromUserId: currentUser.id, fromUserName: currentUser.name, toUserId: msg.to, toUserName: users.find(u => u.id === msg.to)?.name, subject: msg.subject, content: msg.content }); setMsg({ to: '', subject: '', content: '' }); setCompose(false); } };
    const inp = { backgroundColor: t.bg, border: `2px solid ${t.border}`, color: t.text };
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div style={{ backgroundColor: t.card, border: `2px solid ${t.border}` }} className="rounded-lg p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4"><h3 style={{ color: t.accent }} className="text-xl font-bold">Messages</h3><div className="flex space-x-2"><button onClick={() => setCompose(!compose)} style={{ backgroundColor: t.btn, color: t.btnText }} className="px-4 py-2 rounded-lg font-semibold">Nouveau</button><button onClick={onClose} style={{ color: t.text }}><X className="w-6 h-6" /></button></div></div>
                {compose && <div style={{ backgroundColor: t.bg, border: `1px solid ${t.border}` }} className="p-4 rounded-lg mb-4 space-y-3"><div><label style={{ color: t.text }} className="block text-sm font-medium mb-1">Destinataire</label><select value={msg.to} onChange={e => setMsg({ ...msg, to: e.target.value })} style={inp} className="w-full px-3 py-2 rounded-lg"><option value="">Sélectionner</option>{available.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div><div><label style={{ color: t.text }} className="block text-sm font-medium mb-1">Sujet</label><input type="text" value={msg.subject} onChange={e => setMsg({ ...msg, subject: e.target.value })} style={inp} className="w-full px-3 py-2 rounded-lg" /></div><div><label style={{ color: t.text }} className="block text-sm font-medium mb-1">Message</label><textarea value={msg.content} onChange={e => setMsg({ ...msg, content: e.target.value })} style={inp} className="w-full px-3 py-2 rounded-lg" rows="4" /></div><button onClick={send} style={{ backgroundColor: t.btn, color: t.btnText }} className="w-full py-2 rounded-lg font-semibold"><Send className="w-4 h-4 inline mr-2" />Envoyer</button></div>}
                <div className="space-y-3">{userMsgs.length === 0 ? <p style={{ color: t.textMuted }} className="text-center py-8">Aucun message</p> : userMsgs.map(m => { const recv = m.toUserId === currentUser.id; const unread = recv && !m.read; return <div key={m.id} style={{ backgroundColor: unread ? t.bg : t.card, border: `2px solid ${unread ? t.accent : t.border}` }} className="p-4 rounded-lg cursor-pointer" onClick={() => unread && onRead(m.id)}><div className="flex justify-between items-start mb-2"><div><p style={{ color: t.accent }} className="font-semibold">{recv ? `De: ${m.fromUserName}` : `À: ${m.toUserName}`}</p><p style={{ color: t.text }} className="text-sm font-medium">{m.subject}</p></div><span style={{ color: t.textMuted }} className="text-xs">{new Date(m.timestamp).toLocaleString('fr-FR')}</span></div><p style={{ color: t.textMuted }} className="text-sm">{m.content}</p></div>; })}</div>
            </div>
        </div>
    );
}