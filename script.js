import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc, query, where, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// CONFIGURAZIONE
const firebaseConfig = {
    apiKey: "AIzaSyDk5lVeA3mwUzPVa3pY6LBAsjRoYIdshvA",
    authDomain: "leopardi-open.firebaseapp.com",
    projectId: "leopardi-open",
    storageBucket: "leopardi-open.firebasestorage.app",
    messagingSenderId: "303228111366",
    appId: "1:303228111366:web:be79db0b49a837e3c99187"
};

const appInstance = initializeApp(firebaseConfig);
const db = getFirestore(appInstance);
const ADMIN_PASS = "leopleop";

// STATO
let currentEditionId = null;
let currentEditionData = null;
let allPlayers = []; 
let teams = []; 
let matches = []; // Contiene lo stato "nuovo"
let pendingCupAction = null;

// MEMORIA LOCALE PER CONFRONTARE CAMBIAMENTI
let previousMatchesState = {}; 

const $ = (id) => document.getElementById(id);

window.app = {
    router: (page) => {
        document.querySelectorAll('[id^="view-"]').forEach(el => el.classList.add('hide'));
        window.scrollTo(0,0);
        
        if (page === 'landing') $('view-landing').classList.remove('hide');
        if (page === 'players') { $('view-players').classList.remove('hide'); renderPlayersPage(); }
        if (page === 'live') { $('view-live').classList.remove('hide'); loadLatestEdition(true); }
        if (page === 'archive') { $('view-archive').classList.remove('hide'); renderArchiveList(); }
        if (page === 'admin') {
            if (localStorage.getItem('bp_auth')) { 
                $('view-dashboard').classList.remove('hide'); 
                loadEditionsForAdmin(); 
                subscribeToGlobalPlayers(); 
            }
            else $('view-login').classList.remove('hide');
        }
    },

    login: () => {
        if ($('admin-pass').value === ADMIN_PASS) { localStorage.setItem('bp_auth', 'true'); app.router('admin'); }
        else alert("Password Errata");
    },
    logout: () => { localStorage.removeItem('bp_auth'); app.router('landing'); },

    // --- CREA GIOCATORE ---
    createPlayer: async () => {
        const name = $('player-name').value.trim();
        const fileInput = $('player-photo');
        const file = fileInput.files[0];

        if(!name) return alert("Inserisci nome");
        
        const btn = $('btn-save-player');
        btn.disabled = true;
        btn.innerText = "Salvataggio...";
        
        let photoUrl = ""; 

        try {
            if (file) photoUrl = await compressImage(file);

            const stats = {
                hand: $('player-hand').value,
                style: $('player-style').value,
                nickname: $('player-nick').value.trim(), 
                description: $('player-desc').value.trim(), 
                prec: $('stat-prec').value,
                pow: $('stat-pow').value,
                tol: $('stat-tol').value
            };

            await addDoc(collection(db, "players"), { name, photoUrl, ...stats, createdAt: new Date() });
            
            $('player-name').value = '';
            $('player-nick').value = '';
            $('player-desc').value = '';
            fileInput.value = ''; 
            alert("Giocatore salvato!");

        } catch (e) {
            console.error(e);
            alert("Errore: " + e.message);
        } finally {
            btn.disabled = false;
            btn.innerText = "Salva e Carica";
        }
    },

    // --- ADMIN: EDIZIONE ---
    createEdition: async () => {
        const name = $('new-edition-name').value;
        if (!name) return;
        await addDoc(collection(db, "editions"), { name, createdAt: new Date(), status: 'open' });
        $('new-edition-name').value = '';
        alert("Edizione Creata");
    },
    adminChangeEdition: (id) => {
        currentEditionId = id;
        if(id) {
            $('admin-controls').classList.remove('opacity-50', 'pointer-events-none');
            $('admin-live-area').classList.remove('opacity-50', 'pointer-events-none');
            subscribeToEditionData(id);
        } else {
            $('admin-controls').classList.add('opacity-50', 'pointer-events-none');
            $('admin-live-area').classList.add('opacity-50', 'pointer-events-none');
        }
    },
    deleteCurrentEdition: async () => {
        if(!currentEditionId) return alert("Seleziona edizione");
        if(!confirm("⚠️ Cancellare evento?")) return;
        try {
            const batchDelete = async (col) => {
                const q = query(collection(db, col), where("editionId", "==", currentEditionId));
                const snap = await getDocs(q);
                snap.forEach(d => deleteDoc(d.ref));
            };
            await batchDelete("matches");
            await batchDelete("teams");
            await deleteDoc(doc(db, "editions", currentEditionId));
            alert("Evento cancellato.");
            location.reload();
        } catch (e) { alert(e.message); }
    },
    closeEdition: async () => {
        if(!currentEditionId) return;
        if(!confirm("Chiudere l'evento?")) return;
        const finalStats = calculateStatsData(); 
        await updateDoc(doc(db, "editions", currentEditionId), { 
            status: 'closed', 
            podium: { first: $('rank-1').value, second: $('rank-2').value, third: $('rank-3').value },
            topScorers: finalStats.slice(0, 3)
        });
        alert("Archiviato!");
        app.router('archive');
    },

    // --- ADMIN: TEAM & MATCH ---
    createTeam: async () => {
        const p1Id = $('sel-p1').value;
        const p2Id = $('sel-p2').value;
        if(!p1Id || !p2Id || p1Id === p2Id) return alert("Seleziona giocatori validi");
        const p1 = allPlayers.find(p => p.id === p1Id);
        const p2 = allPlayers.find(p => p.id === p2Id);
        await addDoc(collection(db, "teams"), { 
            name: `${p1.name} & ${p2.name}`, 
            p1Id: p1.id, p1Name: p1.name, 
            p2Id: p2.id, p2Name: p2.name, 
            editionId: currentEditionId 
        });
        alert("Team Iscritto");
    },
    createMatch: async () => {
        const tA = $('sel-team-a').value;
        const tB = $('sel-team-b').value;
        const title = $('match-title').value;
        if(!tA || !tB || tA === tB) return alert("Team non validi");
        await addDoc(collection(db, "matches"), {
            title: title || "Match", teamA: tA, teamB: tB,
            hitsA: {}, hitsB: {}, status: 'live', winner: null,
            editionId: currentEditionId, timestamp: new Date()
        });
        $('match-title').value = '';
    },
    deleteItem: async (col, id) => {
        if(confirm("Eliminare?")) await deleteDoc(doc(db, col, id));
    },

    // --- GAMEPLAY ---
    undoHit: async (matchId, teamField, cupNum) => {
        if(!confirm(`Annullare punto?`)) return;
        const match = matches.find(m => m.id === matchId);
        const currentHits = { ...match[teamField] };
        delete currentHits[cupNum];
        const updates = { [teamField]: currentHits };
        if(match.status === 'finished') { updates.status = 'live'; updates.winner = null; }
        await updateDoc(doc(db, "matches", matchId), updates);
    },
    
    handleCupClick: (matchId, teamField, cupNum, teamId) => {
        const team = teams.find(t => t.id === teamId);
        if(!team) return;
        
        const p1 = allPlayers.find(p => p.id === team.p1Id) || { name: team.p1Name, photoUrl: '' };
        const p2 = allPlayers.find(p => p.id === team.p2Id) || { name: team.p2Name, photoUrl: '' };

        pendingCupAction = { matchId, teamField, cupNum, match: matches.find(m => m.id === matchId) };
        
        const renderBtn = (player) => `
            <div class="w-16 h-16 rounded-full bg-cover bg-center border-2 border-white mb-1 shadow-lg" 
                 style="background-image: url('${player.photoUrl || 'https://via.placeholder.com/150?text='+player.name.charAt(0)}')"></div>
            <span class="font-bold text-sm text-white">${player.name}</span>
        `;
        
        $('btn-scorer-p1').innerHTML = renderBtn(p1);
        $('btn-scorer-p1').onclick = () => app.confirmHit(p1.id); 

        $('btn-scorer-p2').innerHTML = renderBtn(p2);
        $('btn-scorer-p2').onclick = () => app.confirmHit(p2.id); 
        
        $('scorer-modal').classList.remove('hide');
    },

    confirmHit: async (playerId) => {
        $('scorer-modal').classList.add('hide');
        const { matchId, teamField, cupNum, match } = pendingCupAction;
        const newHits = { ...match[teamField], [cupNum]: playerId };
        const updates = { [teamField]: newHits };
        if (Object.keys(newHits).length >= 6) {
            updates.status = 'finished';
            updates.winner = teamField === 'hitsA' ? match.teamA : match.teamB;
        }
        await updateDoc(doc(db, "matches", matchId), updates);
    }
};

// --- HELPER COMPRESSIONE ---
const compressImage = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 250;
                const scaleSize = MAX_WIDTH / img.width;
                canvas.width = MAX_WIDTH;
                canvas.height = img.height * scaleSize;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.7)); 
            }
            img.onerror = (err) => reject(err);
        }
        reader.onerror = (err) => reject(err);
    });
};

// --- FETCHING ---
subscribeToGlobalPlayers(); 
function subscribeToGlobalPlayers() {
    onSnapshot(query(collection(db, "players"), orderBy("name")), sn => {
        allPlayers = sn.docs.map(d => ({id: d.id, ...d.data()}));
        renderPlayerSelects();
        if(!$('view-players').classList.contains('hide')) renderPlayersPage();
    });
}
function loadEditionsForAdmin() {
    onSnapshot(query(collection(db, "editions"), orderBy("createdAt", "desc")), (snap) => {
        const list = snap.docs.map(d => ({id: d.id, ...d.data()}));
        $('admin-edition-select').innerHTML = '<option value="">-- Seleziona --</option>' + list.map(e => `<option value="${e.id}">${e.name} ${e.status==='closed'?'(Chiusa)':''}</option>`).join('');
        if(currentEditionId) $('admin-edition-select').value = currentEditionId;
    });
}
async function loadLatestEdition(isLivePage = false) {
    const snap = await getDocs(query(collection(db, "editions"), orderBy("createdAt", "desc")));
    $('live-matches').innerHTML = '';
    $('live-edition-title').innerText = '...';
    $('no-live-msg').classList.add('hide');

    if(!snap.empty) {
        const latestDoc = snap.docs[0];
        const data = latestDoc.data();
        if (isLivePage && data.status === 'closed') {
            $('live-edition-title').innerText = "Nessun Torneo Attivo";
            $('no-live-msg').classList.remove('hide');
            return;
        }
        currentEditionId = latestDoc.id;
        currentEditionData = data;
        $('live-edition-title').innerText = data.name;
        subscribeToEditionData(currentEditionId);
    } else {
        $('live-edition-title').innerText = "Nessun Torneo Attivo";
        if(isLivePage) $('no-live-msg').classList.remove('hide');
    }
}

// *** LOGICA LIVE, ANIMAZIONI E CONFRONTO STATI ***
function subscribeToEditionData(id) {
    onSnapshot(query(collection(db, "teams"), where("editionId", "==", id)), sn => { 
        teams = sn.docs.map(d => ({id: d.id, ...d.data()})); 
        renderTeamSelects(); 
    });

    onSnapshot(query(collection(db, "matches"), where("editionId", "==", id), orderBy("timestamp", "desc")), sn => { 
        const newMatches = sn.docs.map(d => ({id: d.id, ...d.data()}));
        
        // Se non siamo sulla pagina live, non sprecare risorse per animazioni
        const isLiveView = !$('view-live').classList.contains('hide');

        if (isLiveView) {
            newMatches.forEach(newMatch => {
                const oldMatch = previousMatchesState[newMatch.id];

                if (oldMatch) {
                    // 1. CONTROLLO GOAL (Chi ha segnato?)
                    checkGoal(newMatch.hitsA, oldMatch.hitsA, newMatch.teamA);
                    checkGoal(newMatch.hitsB, oldMatch.hitsB, newMatch.teamB);

                    // 2. CONTROLLO FINE PARTITA
                    if (newMatch.status === 'finished' && oldMatch.status !== 'finished') {
                        triggerEndMatch(newMatch);
                    }
                }
            });
        }

        // Aggiorna lo stato precedente e renderizza
        newMatches.forEach(m => previousMatchesState[m.id] = m);
        matches = newMatches;
        renderMatches(); 
        renderStats(); 
    });
}

// Funzione ausiliaria per trovare chi ha segnato
function checkGoal(newHits, oldHits, teamId) {
    const newKeys = Object.keys(newHits || {});
    const oldKeys = Object.keys(oldHits || {});

    // Se c'è un nuovo bicchiere colpito
    if (newKeys.length > oldKeys.length) {
        // Trova quale key (cupId) è nuova
        const diff = newKeys.find(k => !oldKeys.includes(k));
        if (diff) {
            const playerId = newHits[diff];
            triggerGoalAnimation(playerId, teamId);
        }
    }
}

// --- ANIMAZIONI ---

function triggerGoalAnimation(playerId, teamId) {
    const player = allPlayers.find(p => p.id === playerId);
    const team = teams.find(t => t.id === teamId);
    
    // Suona coriandoli
    confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#ff6b00', '#ffffff'] });

    // Mostra Overlay
    const overlay = $('overlay-goal');
    $('overlay-goal-img').style.backgroundImage = `url('${player?.photoUrl || ''}')`;
    $('overlay-goal-name').innerText = player?.name || 'GOL!';
    $('overlay-goal-team').innerText = team?.name || '';
    
    overlay.classList.remove('hide');
    
    // Nascondi dopo 4 secondi
    setTimeout(() => {
        overlay.classList.add('hide');
    }, 4000);
}

function triggerEndMatch(match) {
    const winnerTeam = teams.find(t => t.id === match.winner);
    const loserTeamId = match.winner === match.teamA ? match.teamB : match.teamA;
    const loserTeam = teams.find(t => t.id === loserTeamId);

    $('overlay-end-winner').innerText = winnerTeam?.name || 'VINCITORE';
    $('overlay-end-loser').innerText = loserTeam?.name || 'SCONFITTO';

    const overlay = $('overlay-end');
    overlay.classList.remove('hide');

    // Coriandoli prolungati
    let duration = 3000;
    let end = Date.now() + duration;
    (function frame() {
        confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 }, colors: ['#FFD700'] });
        confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 }, colors: ['#FFD700'] });
        if (Date.now() < end) requestAnimationFrame(frame);
    }());
}

// --- RENDER STANDARD --- (Non modificato)
function renderPlayersPage() {
    const grid = $('public-players-grid');
    if(allPlayers.length === 0) { grid.innerHTML = "<p>Nessun giocatore in database.</p>"; return; }
    
    grid.innerHTML = allPlayers.map(p => `
        <div class="card bg-gray-900 border-2 border-gray-700 rounded-xl overflow-hidden relative group hover:border-blue-500 hover:scale-[1.02] transition-all duration-300 shadow-xl">
            <div class="absolute inset-0 bg-cover bg-center opacity-30" style="background-image: url('${p.photoUrl || 'https://via.placeholder.com/300?text=' + p.name}'); filter: blur(5px);"></div>
            <div class="relative z-10 p-4 flex flex-col items-center">
                <div class="w-28 h-28 rounded-full border-4 border-white shadow-2xl bg-cover bg-center mb-3 relative" 
                     style="background-image: url('${p.photoUrl || 'https://via.placeholder.com/150?text=' + p.name.charAt(0)}')">
                     <div class="absolute bottom-0 right-0 bg-blue-600 rounded-full px-2 py-0.5 text-[10px] font-bold border border-white">${p.hand === 'Destra' ? '🖐️ DX' : '🖐️ SX'}</div>
                </div>
                <h3 class="font-black text-2xl uppercase tracking-wider text-white leading-none mb-1 text-center drop-shadow-md">${p.name}</h3>
                ${p.nickname ? `<div class="text-yellow-400 italic font-serif text-sm mb-2">"${p.nickname}"</div>` : ''}
                <div class="flex flex-wrap gap-2 justify-center mb-4">
                    <span class="px-2 py-0.5 bg-purple-900 border border-purple-500 rounded text-[10px] font-bold uppercase text-purple-300">${p.style}</span>
                </div>
                <div class="w-full grid grid-cols-3 gap-2 bg-black/60 p-3 rounded-lg backdrop-blur-sm border border-gray-700">
                    <div class="flex flex-col items-center"><span class="text-xl mb-1">🎯</span><span class="text-lg font-black text-green-400 leading-none">${p.prec}</span><span class="text-[8px] uppercase text-gray-500 font-bold mt-1">Prec</span></div>
                    <div class="flex flex-col items-center border-l border-gray-700"><span class="text-xl mb-1">🔥</span><span class="text-lg font-black text-red-500 leading-none">${p.pow}</span><span class="text-[8px] uppercase text-gray-500 font-bold mt-1">Pow</span></div>
                    <div class="flex flex-col items-center border-l border-gray-700"><span class="text-xl mb-1">🍺</span><span class="text-lg font-black text-yellow-500 leading-none">${p.tol}</span><span class="text-[8px] uppercase text-gray-500 font-bold mt-1">Res</span></div>
                </div>
                ${p.description ? `<div class="mt-3 text-center text-xs text-gray-400 italic font-serif border-t border-gray-700 pt-2 w-full">"${p.description}"</div>` : ''}
            </div>
        </div>
    `).join('');
}

function renderMatches() {
    const renderCard = (m, isAdmin) => `
        <div class="card p-4 relative ${m.status==='live' ? 'border-green-500/50' : ''}">
            ${isAdmin ? `<div class="flex justify-between mb-2 border-b border-gray-700 pb-1"><span class="text-[10px] uppercase font-bold text-gray-500">${m.title||'Match'}</span> <button onclick="app.deleteItem('matches','${m.id}')" class="text-red-500 text-xs">🗑️</button></div>` 
                      : `<div class="text-center text-[10px] text-gray-500 uppercase font-bold mb-4 tracking-widest">${m.title||'Match'} ${m.status==='live'?'<span class="text-green-500 animate-pulse ml-2">● LIVE</span>':''}</div>`}
            <div class="grid grid-cols-2 gap-4">
                <div class="flex flex-col items-center">
                    <div class="text-sm font-bold mb-2 truncate max-w-full ${m.winner===m.teamA ? 'text-bp':''}">${getTeamName(m.teamA)}</div>
                    ${renderPyramid(m.hitsA, isAdmin, m.id, 'hitsA', m.teamA)}
                    ${renderHitTrace(m.hitsA, isAdmin, m.id, 'hitsA')}
                </div>
                <div class="flex flex-col items-center border-l border-gray-800 pl-4">
                    <div class="text-sm font-bold mb-2 truncate max-w-full ${m.winner===m.teamB ? 'text-bp':''}">${getTeamName(m.teamB)}</div>
                    ${renderPyramid(m.hitsB, isAdmin, m.id, 'hitsB', m.teamB)}
                    ${renderHitTrace(m.hitsB, isAdmin, m.id, 'hitsB')}
                </div>
            </div>
        </div>`;
    $('live-matches').innerHTML = matches.map(m => renderCard(m, false)).join('');
    $('admin-matches').innerHTML = matches.map(m => renderCard(m, true)).join('');
}

function renderPyramid(hitsObj, isAdmin, matchId, teamField, teamId) {
    const allCups = [1, 2, 3, 4, 5, 6];
    const hitCups = Object.keys(hitsObj || {}); 
    const remaining = allCups.filter(c => !hitCups.includes(c.toString()));
    const count = remaining.length;
    let rows = [];
    if (count >= 5) rows = [[1], [2, 3], [4, 5, 6]];
    else if (count === 4) rows = [[remaining[0]], [remaining[1], remaining[2]], [remaining[3]]];
    else if (count === 3) rows = [[remaining[0]], [remaining[1], remaining[2]]];
    else if (count === 2) rows = [[remaining[0]], [remaining[1]]];
    else if (count === 1) rows = [[remaining[0]]];

    let html = '<div class="flex flex-col items-center gap-1 min-h-[100px] justify-center transition-all duration-300">';
    rows.forEach(row => {
        html += '<div class="flex gap-1">';
        row.forEach(cupId => {
            const isHitInStaticMode = (count >= 5) && hitCups.includes(cupId.toString());
            if (isHitInStaticMode) {
                const playerId = hitsObj[cupId];
                const player = allPlayers.find(p => p.id === playerId);
                const bg = player ? player.photoUrl : '';
                if (bg) html += `<div class="w-8 h-8 rounded-full border border-gray-700/50 bg-cover bg-center grayscale opacity-50" style="background-image: url('${bg}')"></div>`;
                else html += `<div class="w-8 h-8 rounded-full border border-gray-700/50"></div>`;
            } else {
                if (isAdmin) {
                     html += `<button onclick="app.handleCupClick('${matchId}', '${teamField}', '${cupId}', '${teamId}')" class="w-8 h-8 rounded-full bg-darksec hover:bg-gray-600 border border-gray-500 flex items-center justify-center font-bold text-xs shadow-lg transition-transform hover:scale-110">${cupId}</button>`;
                } else {
                     html += `<div class="w-8 h-8 rounded-full cup-red"></div>`;
                }
            }
        });
        html += '</div>';
    });
    html += '</div>';
    return html;
}

function renderHitTrace(hitsObj, isAdmin, matchId, teamField) {
    const entries = Object.entries(hitsObj || {});
    if(entries.length === 0) return '<div class="h-6"></div>';
    return `<div class="flex flex-wrap gap-1 mt-2 justify-center max-w-[120px]">${entries.map(([cupId, playerId]) => {
        const player = allPlayers.find(p => p.id === playerId);
        const bg = player ? player.photoUrl : '';
        const action = isAdmin ? `onclick="app.undoHit('${matchId}', '${teamField}', '${cupId}')"` : '';
        const style = isAdmin ? "cursor-pointer hover:border-red-500" : "";
        return `<div ${action} class="w-8 h-8 rounded-full bg-cover bg-center border-2 border-white/50 shadow-md ${style}" style="background-image: url('${bg || 'https://via.placeholder.com/50'}')" title="${player?.name}"></div>`
    }).join('')}</div>`;
}

function renderPlayerSelects() {
    const opts = allPlayers.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    $('sel-p1').innerHTML = '<option value="">Seleziona P1</option>' + opts;
    $('sel-p2').innerHTML = '<option value="">Seleziona P2</option>' + opts;
    $('players-list-tiny').innerHTML = allPlayers.map(p => `
        <div class="flex justify-between border-b border-gray-800 pb-1 items-center">
            <span class="font-bold text-gray-300">${p.name}</span> 
            <span onclick="app.deleteItem('players','${p.id}')" class="cursor-pointer text-red-500 text-[10px] uppercase hover:bg-red-900/50 px-1 rounded">elimina</span>
        </div>`).join('');
}

function renderTeamSelects() {
    const opts = teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    $('sel-team-a').innerHTML = '<option value="">Seleziona Team A</option>' + opts;
    $('sel-team-b').innerHTML = '<option value="">Seleziona Team B</option>' + opts;
    const listEl = $('teams-list-admin');
    if (listEl) {
        listEl.innerHTML = teams.map(t => `
            <div class="flex justify-between border-b border-gray-800 pb-1 items-center">
                <span class="font-bold text-gray-300 truncate w-3/4">${t.name}</span>
                <button onclick="app.deleteItem('teams', '${t.id}')" class="text-red-500 hover:text-red-400 text-[10px] uppercase border border-red-900/30 px-1 rounded">X</button>
            </div>
        `).join('');
    }
}

function getTeamName(id) { return teams.find(t => t.id === id)?.name || '...'; }
function calculateStatsData() {
    const scores = {};
    matches.forEach(m => { processHits(m.hitsA, m.teamA, scores); processHits(m.hitsB, m.teamB, scores); });
    return Object.entries(scores).sort((a,b) => b[1] - a[1]).map(entry => ({ name: entry[0], score: entry[1] }));
}
function processHits(map, tId, scores) {
    if(!map) return;
    const t = teams.find(x => x.id === tId);
    if(!t) return;
    Object.values(map).forEach(pid => {
        const p = allPlayers.find(pl => pl.id === pid);
        if(p) scores[p.name] = (scores[p.name] || 0) + 1;
    });
}

function renderStats() {
    const stats = calculateStatsData();
    const tickerContainer = $('live-ticker-content');
    
    if(!tickerContainer) return;

    if (stats.length === 0) {
        tickerContainer.innerHTML = '<span class="ticker-item">Nessun punto segnato...</span>';
        return;
    }

    const htmlContent = stats.map((s, i) => `
        <span class="ticker-item">
            <span class="rank">#${i+1}</span>
            ${s.name}
            <span class="score">(${s.score})</span>
        </span>
        <span class="text-gray-700 mx-2">•</span>
    `).join('');

    const separator = `
        <span class="ticker-item" style="color: #ff6b00; font-weight: 900; margin: 0 50px; font-style: italic; letter-spacing: 2px;">
            ★ LEOPARDI OPEN ★
        </span>
    `;

    tickerContainer.innerHTML = htmlContent + separator + htmlContent + separator + htmlContent;
}

function renderArchiveList() {
    onSnapshot(query(collection(db, "editions"), orderBy("createdAt", "desc")), (snap) => {
        const list = snap.docs.map(d => ({id: d.id, ...d.data()}));
        const el = $('archive-list');
        if(!list.length) { el.innerHTML = "Nessun evento passato."; return; }
        el.innerHTML = list.map(e => {
            if (e.status === 'closed') {
                const p = e.podium || {};
                const scorers = e.topScorers || [];
                const renderScorers = scorers.map((s, i) => `<div class="flex justify-between text-xs border-b border-gray-800 pb-1 mb-1"><span class="text-gray-300">#${i+1} ${s.name}</span><span class="font-bold text-bp">${s.score}</span></div>`).join('');
                return `
                <div class="card p-6 border-l-4 border-l-yellow-600 bg-gradient-to-br from-darksec to-black">
                    <h3 class="text-2xl font-black italic mb-4 text-white">${e.name}</h3>
                    <div class="grid grid-cols-2 gap-4 text-sm">
                        <div class="space-y-2">
                            <div class="text-[10px] uppercase text-gray-500 font-bold mb-1">Podio Team</div>
                            <div class="text-yellow-500 font-bold text-lg">🥇 ${p.first || 'N/A'}</div>
                            <div class="text-gray-300">🥈 ${p.second || '-'}</div>
                            <div class="text-orange-700">🥉 ${p.third || '-'}</div>
                        </div>
                        <div class="border-l border-gray-700 pl-4 flex flex-col">
                            <div class="text-[10px] uppercase text-gray-500 font-bold mb-2">Top Marcatori</div>
                            ${renderScorers || '<span class="text-gray-500 italic">Dati non disponibili</span>'}
                        </div>
                    </div>
                </div>`;
            } else {
                return `<div class="card p-4 border border-gray-700 opacity-70"><div class="flex justify-between items-center"><h3 class="font-bold text-gray-400">${e.name}</h3><span class="text-xs bg-green-900 text-green-400 px-2 py-1 rounded">IN CORSO</span></div></div>`;
            }
        }).join('');
    });
}