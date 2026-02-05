/* Performer <-> Character assignment app
   Single-file JS controlling the UI.
*/
(() => {
    // Data model
    let performerIdCounter = 1;
    let projectIdCounter = 1;
    let characterIdCounter = 1;
    // set when loading an existing file 
    let loadedFileName = null
    let loadedFileSaveDate = null

    const performers = {}; // id -> {id,name,gender,performed,everAssignedThisSession,lastPerformed}
    const projects = []; // {id,name,characters:[{id,name,gender,assigned:null}]}
    let extras = new Set(); // performer ids currently in extras pool

    let currentProjectId = null;
    let lastUpdated = 0; // unix timestamp of last file save

    // Settings
    let settings = {
        separateMF: false // whether to separate M/F roles in character list
    };

    // Helpers
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => Array.from(document.querySelectorAll(sel));

    function editPerformerName(oldName, newName) {
        const id = Object.entries(performers).find(
            ([_, value]) => value.name === oldName
        )?.[0];
        performers[id].name = newName;
    }
    function newPerformer(name, gender = 'M', performed = 0, lastPerformed = 0) {
        const id = 'p' + (performerIdCounter++);
        performers[id] = { id, name, gender, performed: clamp(performed, 0, 9), everAssignedThisSession: false, lastPerformed: lastPerformed };
        return id;
    }
    function newProject(name) {
        const id = 'proj' + (projectIdCounter++);
        projects.push({ id, name, characters: [] });
        if (!currentProjectId) currentProjectId = id;

        // Move all currently assigned characters back to extras before switching
        const old = projects.find(p => p.id === currentProjectId);
        if (old) {
            for (const ch of old.characters) if (ch.assigned) { extras.add(ch.assigned); ch.assigned = null; }
        }

        return id;
    }
    function newCharacter(projectId, name, gender = 'M') {
        const id = 'c' + (characterIdCounter++);
        const proj = projects.find(p => p.id === projectId);
        proj.characters.push({ id, name, gender, assigned: null });
        return id;
    }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    function applyGenderClass(btn, gender) {
        btn.classList.remove('gender-m', 'gender-f');
        if (gender === 'M') btn.classList.add('gender-m');
        if (gender === 'F') btn.classList.add('gender-f');
    }

    function isToday(date) {
        const today = new Date();
        return date.getFullYear() === today.getFullYear() &&
            date.getMonth() === today.getMonth() &&
            date.getDate() === today.getDate();
    }

    // Initial data
    newProject('Project 1');

    // --- Rendering ---
    function renderAll() {
        renderProjectSelect();
        renderPerformerList();
        renderExtras();
        renderCharacterList();
    }

    function renderProjectSelect() {
        const sel = $('#project-select');
        sel.innerHTML = '';
        projects.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id; opt.textContent = p.name;
            sel.appendChild(opt);
        });
        if (!projects.length) {
            newProject('Project 1');
        }
        if (!currentProjectId) currentProjectId = projects[0].id;
        sel.value = currentProjectId;
    }

    function renderPerformerList() {
        const container = $('#performer-list');
        container.innerHTML = '';
        const list = Object.values(performers)
            .filter(p => !extras.has(p.id) && !isAssigned(p.id))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        if (!list.length) {
            container.innerHTML = `<div class="empty">No performers. Add performers or drag from Extras.</div>`;
            return;
        }
        list.forEach(p => {
            const item = document.createElement('div');
            item.className = 'performer-item';
            item.draggable = true;
            item.dataset.id = p.id;

            item.innerHTML = `
        <div class="item-left">
          <div class="item-name">${escapeHtml(p.name)}</div>
          <button class="gender-btn ${p.gender === 'M' ? 'gender-m' : 'gender-f'}" data-action="toggle-gender">${p.gender}</button>
        </div>
        <div>
          <button class="small-btn" data-action="to-extras">⇉</button>
          <button class="small-btn" data-action="edit-performer">✏️</button>
          <button class="delete-btn" data-action="delete">X</button>
        </div>
      `;
            // drag handlers
            item.addEventListener('dragstart', ev => {
                ev.dataTransfer.setData('text/plain', p.id);
            });
            // buttons
            item.querySelector('[data-action="toggle-gender"]').addEventListener('click', (e) => {
                p.gender = p.gender === 'M' ? 'F' : 'M';
                const btn = e.target;
                btn.textContent = p.gender;
                applyGenderClass(btn, p.gender);
                renderAll()
            });
            item.querySelector('[data-action="to-extras"]').addEventListener('click', () => {
                moveToExtras(p.id);
                renderAll()
            });
            item.querySelector('[data-action="edit-performer"]').addEventListener('click', () => {
                $('#edit-performer-input').value = p.name;
                $('#edit-performer-error').textContent = '';
                $('#edit-performer-input').placeholder = p.name;
                openModal('#edit-performer-modal');
                $('#edit-performer-input').focus();
            });
            item.querySelector('[data-action="delete"]').addEventListener('click', () => {
                confirmAction(`Delete performer "${p.name}"?`, () => deletePerformer(p.id));
            });

            container.appendChild(item);
        });
    }

    function renderExtras() {
        const container = $('#extras-dropzone');
        container.innerHTML = '';
        const arr = Array.from(extras)
        if (!arr.length) {
            container.innerHTML = `<div class="empty">No performers in Extras.</div>`;
            return;
        }
        let orderNum = 0
        arr.forEach(id => {
            orderNum++;
            const p = performers[id];
            if (!p) return;
            const item = document.createElement('div');
            item.className = 'extra-item';
            item.draggable = true;
            item.dataset.id = id;
            item.innerHTML = `
        <div class="item-left">
            <div style="text-align:center;background-color:var(--muted);color:var(--bg);width:26px;border-radius:50%;padding:2px">${orderNum}</div>
            <div class="item-name">${escapeHtml(p.name)}</div>
            <button class="gender-btn ${p.gender === 'M' ? 'gender-m' : 'gender-f'}" data-action="toggle-gender">${p.gender}</button>
        </div>
        <div>
            <button class="small-btn" data-action="to-performer-list">⇇</button>
        </div>
      `;
            item.addEventListener('dragstart', ev => {
                ev.dataTransfer.setData('text/plain', id);
            });
            item.querySelector('[data-action="toggle-gender"]').addEventListener('click', (e) => {
                p.gender = p.gender === 'M' ? 'F' : 'M';
                const btn = e.target;
                btn.textContent = p.gender;
                applyGenderClass(btn, p.gender);
                renderAll()
            });
            item.querySelector('[data-action="to-performer-list"]').addEventListener('click', () => {
                extras.delete(id);
                renderAll();
            });

            container.appendChild(item);
        });
    }

    function renderCharacterList() {
        const container = $('#character-list');
        container.innerHTML = '';
        const proj = projects.find(p => p.id === currentProjectId);
        if (!proj) return;
        if (!proj.characters.length) {
            container.innerHTML = `<div class="empty">No characters in this project.</div>`;
            return;
        }
        const sortedCharacters = [...proj.characters].sort((a, b) => {
            // Gender priority: M first, F second (only if separateMF is enabled)
            if (settings.separateMF && a.gender !== b.gender) {
                if (a.gender === 'M') return -1;
                if (b.gender === 'M') return 1;
            }

            // Alphabetical by name
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });

        sortedCharacters.forEach(ch => {
            const card = document.createElement('div');
            card.className = 'character-card';
            card.dataset.charId = ch.id;
            card.innerHTML = `
        <div class="character-top-row">
          <div style="display:flex;align-items:center;gap:8px">
            <strong>${escapeHtml(ch.name)}</strong>
            <button class="gender-btn ${ch.gender === 'M' ? 'gender-m' : 'gender-f'}" data-action="toggle-g">${ch.gender}</button>
          </div>
          <div>
            <button class="small-btn" data-action="random-char">🎲</button>
            <button class="delete-btn" data-action="delete-char">🔪</button>
          </div>
        </div>
        <div class="character-dropzone dropzone" data-target="character" data-charid="${ch.id}">
          ${ch.assigned ? renderAssignedPerformerInline(ch.assigned) : '<div class="small-muted">Drop performer here</div>'}
        </div>
      `;
            // attach event listeners for delete/toggle/unassign
            card.querySelector('[data-action="toggle-g"]').addEventListener('click', (e) => {
                ch.gender = ch.gender === 'M' ? 'F' : 'M';
                const btn = e.target;
                btn.textContent = ch.gender;
                applyGenderClass(btn, ch.gender);
                renderAll()
            });
            card.querySelector('[data-action="delete-char"]').addEventListener('click', () => {
                confirmAction(`Delete character "${ch.name}"?`, () => deleteCharacter(ch.id));
            });
            card.querySelector('[data-action="random-char"]').addEventListener('click', () => {
                // Find all extras matching this character's gender
                const candidates = Array.from(extras).filter(pid => performers[pid] && performers[pid].gender === ch.gender);
                if (candidates.length === 0) {
                    console.log(`No available performers in Extras for gender ${ch.gender}.`);
                    return;
                }
                // Weighted random pick using performed penalty
                let totalWeight = 0;
                const weights = {};
                candidates.forEach(entry => {
                    const perf = performers[entry];
                    const weight = 10 - perf.performed; // 1..10
                    weights[entry] = weight;
                    totalWeight += weight;
                });

                // Debug log
                console.log(`Character: ${ch.name}`);
                candidates.forEach(entry => {
                    const p = performers[entry];
                    console.log(weights[entry])
                    console.log(totalWeight)
                    const prob = weights[entry] / totalWeight;
                    console.log(`  ${p.name}: ${(prob * 100).toFixed(2)}%`);
                });

                // Pick a performer
                const pickIdx = weightedRandomPick(weights, totalWeight);
                dropOntoCharacter(pickIdx, ch.id);
            });

            container.appendChild(card);

            // setup dropzone listeners for this character
            const dropzone = card.querySelector('.character-dropzone');
            setupDropHandlers(dropzone);
        });
    }

    function renderAssignedPerformerInline(performerId) {
        const p = performers[performerId];
        if (!p) return '<div class="small-muted">Invalid performer</div>';
        return `
      <div class="performer-item" draggable="true" data-id="${p.id}">
        <div class="item-left">
          <div class="item-name">${escapeHtml(p.name)}</div>
        </div>
        <div>
          <button class="small-btn" data-action="remove-assignment">⇇</button>
        </div>
      </div>
    `;
    }

    // --- Utilities ---
    function isAssigned(performerId) {
        for (const p of projects) {
            for (const ch of p.characters) if (ch.assigned === performerId) return true;
        }
        return false;
    }

    function findCharacterByAssignedPerformer(perfId) {
        for (const p of projects) {
            for (const ch of p.characters) if (ch.assigned === perfId) return ch;
        }
        return null;
    }

    function findProjectByCharacter(charId) {
        return projects.find(proj => proj.characters.some(c => c.id === charId));
    }

    // --- Drag & Drop setup ---
    function setupGlobalDnD() {
        // Drop handlers for performer-list and extras (we make them accept drops)
        ['#performer-list', '#extras-dropzone'].forEach(sel => {
            const elem = $(sel);
            setupDropHandlers(elem);
        });
    }

    function setupDropHandlers(elem) {
        if (!elem) return;
        elem.addEventListener('dragover', ev => {
            ev.preventDefault();
            elem.classList.add('dragover');
        });
        elem.addEventListener('dragleave', ev => {
            elem.classList.remove('dragover');
        });
        elem.addEventListener('drop', ev => {
            ev.preventDefault();
            elem.classList.remove('dragover');
            const id = ev.dataTransfer.getData('text/plain');
            if (!id) return;
            const targetType = elem.dataset.target;
            if (targetType === 'extras') {
                // move id to extras (remove from performer list or assigned character)
                moveToExtras(id);
            } else if (targetType === 'performerList') {
                // remove from extras or a character and show in performer list
                extras.delete(id);
                const ch = findCharacterByAssignedPerformer(id);
                if (ch) ch.assigned = null;
                renderAll();
            } else if (targetType === 'character') {
                const charId = elem.dataset.charid;
                dropOntoCharacter(id, charId);
            } else {
                // fallback: ignore
            }
        });
    }

    function dropOntoCharacter(performerId, charId) {
        const proj = findProjectByCharacter(charId);
        if (!proj) return;
        const ch = proj.characters.find(c => c.id === charId);
        if (!ch) return;
        // remove from previous locations: extras or performer list or previously assigned character
        extras.delete(performerId);
        const prevChar = findCharacterByAssignedPerformer(performerId);
        if (prevChar) prevChar.assigned = null;
        // If this character already has a performer assigned, send them to Extras
        if (ch.assigned) {
            extras.add(ch.assigned);
        }
        ch.assigned = performerId;
        // mark as assigned this session
        performers[performerId].everAssignedThisSession = true;
        renderAll();
    }

    function moveToExtras(performerId) {
        // remove from performer list or assigned characters
        // if performerId is not valid, ignore
        if (!performers[performerId]) return;
        // if assigned to character, unassign
        const ch = findCharacterByAssignedPerformer(performerId);
        if (ch) ch.assigned = null;
        extras.add(performerId);
        console.log(`[DEBUG] Performer "${performers[performerId].name}" moved to Extras. Performed value: ${performers[performerId].performed}`);
        renderAll();
    }

    // --- Add / Delete / Confirm functions ---
    function confirmAction(message, okCallback, title = 'Confirm') {
        const modal = $('#confirm-modal');
        $('#modal-backdrop').classList.remove('hidden');
        modal.classList.remove('hidden');
        $('#confirm-title').textContent = title;
        $('#confirm-message').textContent = message;
        const ok = $('#confirm-ok');
        const cancel = $('#confirm-cancel');

        function cleanup() {
            modal.classList.add('hidden');
            $('#modal-backdrop').classList.add('hidden');
            ok.removeEventListener('click', onOk);
            cancel.removeEventListener('click', onCancel);
        }
        function onOk() { cleanup(); okCallback(); }
        function onCancel() { cleanup(); }
        ok.addEventListener('click', onOk);
        cancel.addEventListener('click', onCancel);
    }

    function deletePerformer(id) {
        // remove from extras, assigned locations and the performers map
        extras.delete(id);
        // remove assignment where present
        for (const proj of projects) {
            for (const ch of proj.characters) if (ch.assigned === id) ch.assigned = null;
        }
        delete performers[id];
        renderAll();
    }

    function deleteCharacter(charId) {
        const proj = findProjectByCharacter(charId);
        if (!proj) return;
        const idx = proj.characters.findIndex(c => c.id === charId);
        if (idx === -1) return;
        const ch = proj.characters[idx];
        if (ch.assigned) {
            extras.add(ch.assigned);
            ch.assigned = null;
        }
        proj.characters.splice(idx, 1);
        renderAll();
    }

    function deleteProject(projectId) {
        if (projects.length <= 1) {
            alert('Cannot delete the only project.');
            return;
        }
        const idx = projects.findIndex(p => p.id === projectId);
        if (idx === -1) return;
        // move assigned performers to extras
        const proj = projects[idx];
        for (const ch of proj.characters) if (ch.assigned) { extras.add(ch.assigned); ch.assigned = null; }
        projects.splice(idx, 1);
        // change current project to first
        currentProjectId = projects[0].id;
        renderAll();
    }

    // --- Add modals and parsing ---
    function openModal(modalId) {
        $('#modal-backdrop').classList.remove('hidden');
        $(modalId).classList.remove('hidden');
    }
    function closeModal(modalId) {
        $('#modal-backdrop').classList.add('hidden');
        $(modalId).classList.add('hidden');
    }

    // Add performers modal logic
    $('#add-performer-btn').addEventListener('click', () => {
        $('#add-performers-input').value = '';
        $('#add-performers-error').textContent = '';
        openModal('#add-performers-modal');
        $('#add-performers-input').focus();
    });
    $('#add-performers-cancel').addEventListener('click', () => closeModal('#add-performers-modal'));
    $('#add-performers-submit').addEventListener('click', () => {
        const raw = $('#add-performers-input').value;
        const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
        const err = $('#add-performers-error');
        err.textContent = '';
        if (!lines.length) { err.textContent = 'Please enter at least one name.'; return; }
        // check duplicates within lines
        const lower = lines.map(l => l.toLowerCase());
        const dup = lower.find((v, i) => lower.indexOf(v) !== i);
        if (dup) { err.textContent = `Duplicate within input: "${dup}".`; return; }
        // check against existing performers
        for (const name of lines) {
            const exists = Object.values(performers).some(p => p.name.toLowerCase() === name.toLowerCase());
            if (exists) { err.textContent = `Performer "${name}" already exists.`; return; }
        }
        // add with default M and performed=0
        lines.forEach(name => newPerformer(name, 'M', 0));
        closeModal('#add-performers-modal');
        renderAll();
    });

    // --- Add Project Modal Logic ---
    $('#add-project-btn').addEventListener('click', () => {
        $('#add-project-input').value = '';
        $('#add-project-error').textContent = '';
        openModal('#add-project-modal');
        $('#add-project-input').focus();
    });

    $('#add-project-cancel').addEventListener('click', () => {
        closeModal('#add-project-modal');
    });

    $('#add-project-submit').addEventListener('click', () => {
        const name = $('#add-project-input').value.trim();
        const err = $('#add-project-error');
        err.textContent = '';

        if (!name) {
            err.textContent = 'Project name cannot be empty.';
            return;
        }

        // Prevent duplicate project names
        const exists = projects.some(p => p.name.toLowerCase() === name.toLowerCase());
        if (exists) {
            err.textContent = 'A project with this name already exists.';
            return;
        }

        const id = newProject(name);
        currentProjectId = id;

        closeModal('#add-project-modal');
        renderAll();
    });


    // --- Edit Project Modal Logic ---
    $('#edit-project-btn').addEventListener('click', () => {
        const proj = projects.find(p => p.id === currentProjectId);
        if (!proj) return;
        $('#edit-project-input').value = proj.name;
        $('#edit-project-input').placeholder = proj.name;
        $('#edit-project-error').textContent = '';
        openModal('#edit-project-modal');
        $('#edit-project-input').focus();
    });

    $('#edit-project-cancel').addEventListener('click', () => {
        closeModal('#edit-project-modal');
    });

    $('#edit-project-submit').addEventListener('click', () => {
        const newName = $('#edit-project-input').value.trim();
        const err = $('#edit-project-error');
        err.textContent = '';
        if (!newName) {
            err.textContent = 'Project name cannot be empty.';
            return;
        }
        // Prevent duplicate names (excluding current project)
        const exists = projects.some(p => p.id !== currentProjectId && p.name.toLowerCase() === newName.toLowerCase());
        if (exists) {
            err.textContent = 'A project with this name already exists.';
            return;
        }
        const proj = projects.find(p => p.id === currentProjectId);
        if (!proj) return;
        proj.name = newName;
        closeModal('#edit-project-modal');
        renderAll();
    });

    // Add characters modal logic
    $('#add-character-btn').addEventListener('click', () => {
        $('#add-characters-input').value = '';
        $('#add-characters-error').textContent = '';
        openModal('#add-characters-modal');
        $('#add-characters-input').focus();
    });
    $('#add-characters-cancel').addEventListener('click', () => closeModal('#add-characters-modal'));
    $('#add-characters-submit').addEventListener('click', () => {
        const raw = $('#add-characters-input').value;
        const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
        const err = $('#add-characters-error');
        err.textContent = '';
        if (!lines.length) { err.textContent = 'Please enter at least one character.'; return; }
        // duplicates within
        const lower = lines.map(l => l.toLowerCase());
        const dup = lower.find((v, i) => lower.indexOf(v) !== i);
        if (dup) { err.textContent = `Duplicate within input: "${dup}".`; return; }
        // check against existing characters in current project
        const proj = projects.find(p => p.id === currentProjectId);
        for (const name of lines) {
            const exists = proj.characters.some(c => c.name.toLowerCase() === name.toLowerCase());
            if (exists) { err.textContent = `Character "${name}" already exists in project.`; return; }
        }
        lines.forEach(name => newCharacter(currentProjectId, name, 'M'));
        closeModal('#add-characters-modal');
        renderAll();
    });

    // Separate M/F toggle
    $('#separate-mf-toggle').addEventListener('change', (e) => {
        settings.separateMF = e.target.checked;
        renderAll();
    });

    // Edit performers modal logic
    $('#edit-performer-cancel').addEventListener('click', () => closeModal('#edit-performer-modal'));
    $('#edit-performer-submit').addEventListener('click', () => {
        const oldName = $('#edit-performer-input').placeholder;
        const newName = $('#edit-performer-input').value.trim();
        const err = $('#edit-performer-error');
        err.textContent = '';
        if (newName.length < 1) { err.textContent = 'Please enter a name.'; return; }
        // check against existing performers
        const exists = Object.values(performers).some(p => p.name.toLowerCase() === newName.toLowerCase() && p.name.toLowerCase() !== oldName.toLowerCase());
        if (exists) { err.textContent = `Performer "${newName}" already exists.`; return; }
        editPerformerName(oldName, newName);
        closeModal('#edit-performer-modal');
        renderAll();
    });

    // Save file as modal logic
    $('#save-as-cancel').addEventListener('click', () => closeModal('#save-as-modal'));
    $('#save-as-submit').addEventListener('click', () => {
        const fName = $('#save-as-input').value.trim();
        const err = $('#save-as-error');
        err.textContent = '';
        if (fName.length < 1) { err.textContent = 'Please enter a file name.'; return; }
        exportData(fName.replace('.json', ''));
        closeModal('#save-as-modal');
        renderAll();
    });

    // Projects
    $('#delete-project-btn').addEventListener('click', () => {
        const proj = projects.find(p => p.id === currentProjectId);
        confirmAction(`Delete project "${proj.name}"?`, () => deleteProject(currentProjectId));
    });
    $('#project-select').addEventListener('change', (e) => {
        const newId = e.target.value;
        // Move all currently assigned characters back to extras before switching
        const old = projects.find(p => p.id === currentProjectId);
        if (old) {
            for (const ch of old.characters) if (ch.assigned) { extras.add(ch.assigned); ch.assigned = null; }
        }
        currentProjectId = newId;
        renderAll();
    });

    // Random assign button
    $('#random-assign-btn').addEventListener('click', () => {
        randomAssign(false);
    });

    // Swap button
    $('#swap-btn').addEventListener('click', () => {
        swapAssign();
    });

    // Export / Import
    $('#export-btn').addEventListener('click', () => {
        if (!loadedFileName) {
            $('#save-as-input').value = '';
            $('#save-as-error').textContent = '';
            openModal('#save-as-modal');
            $('#save-as-input').focus();
        } else {
            exportData(loadedFileName);
        }
    });
    // Import button triggers hidden file input
    $('#import-btn').addEventListener('click', () => {
        $('#import-file').click();
    });

    // Handle file selection
    $('#import-file').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (ev) {
            try {
                console.log("Loading file:", file.name);
                const data = JSON.parse(ev.target.result);
                console.log("Parsed data:", data);
                loadData(data);
                console.log("Data loaded successfully.");
                e.target.value = ''; // reset input
                loadedFileName = file.name.replace('.json', '');
                loadedFileSaveDate = new Date(parseInt(data.saveDate))
            } catch (err) {
                alert('Invalid JSON file.');
            }
        };
        reader.readAsText(file);
    });

    // --- Random assignment logic ---
    function shuffleExtras() {
        // Step 1: Convert to array
        const arr = Array.from(extras);

        // Step 2: Shuffle array using Fisher–Yates algorithm
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]]; // swap
        }

        // Step 3: Convert back to Set (optional)
        extras = new Set(arr);
    }

    function randomAssign(prioritizeUnassigned = false, previouslyAssigned = new Set()) {
        const proj = projects.find(p => p.id === currentProjectId);
        if (!proj) return;

        // Move all current assignments to Extras
        for (const ch of proj.characters) {
            if (ch.assigned) {
                extras.add(ch.assigned);
                ch.assigned = null;
            }
        }

        // For each character attempt to choose from extras matching gender
        for (const ch of proj.characters) {
            let candidates = []
            if (prioritizeUnassigned) {
                candidates = Array.from(extras).filter(pid =>
                    performers[pid] && performers[pid].gender === ch.gender && !previouslyAssigned.has(pid)
                );
            }
            if (candidates.length === 0) {
                candidates = Array.from(extras).filter(pid =>
                    performers[pid] && performers[pid].gender === ch.gender
                );
            }
            if (candidates.length === 0) {
                console.log(`[RANDOM] No candidates for character "${ch.name}" (gender ${ch.gender}).`);
                continue;
            }
            // compute weights
            const weights = {};
            let totalWeight = 0;
            candidates.forEach(pid => {
                const perf = performers[pid];
                let baseWeight = (10 - perf.performed); // 1..10
                weights[pid] = baseWeight;
                totalWeight += baseWeight;
            });
            // Logging: show character and each performer's probability
            console.log(`Character: ${ch.name}`);
            candidates.forEach(pid => {
                const p = performers[pid];
                const prob = weights[pid] / totalWeight;
                console.log(`  ${p.name}: ${(prob * 100).toFixed(2)}%`);
            });
            // weighted random pick
            const pick = weightedRandomPick(weights, totalWeight);
            // assign
            ch.assigned = pick;
            extras.delete(pick);
            performers[pick].everAssignedThisSession = true;
        }
        shuffleExtras()
        renderAll();
    }

    function swapAssign() {
        const proj = projects.find(p => p.id === currentProjectId);
        if (!proj) return;

        // Capture previously assigned performers
        const previouslyAssigned = new Set();
        for (const ch of proj.characters) {
            if (ch.assigned) previouslyAssigned.add(ch.assigned);
        }

        // Move all current assignments to Extras
        for (const ch of proj.characters) {
            if (ch.assigned) {
                extras.add(ch.assigned);
                ch.assigned = null;
            }
        }
        randomAssign(true, previouslyAssigned)
    }

    function weightedRandomPick(weights, total) {
        let r = Math.random() * total;
        for (const pid in weights) {
            r -= weights[pid];
            if (r <= 0) return pid;
        }
        // fallback
        return Object.keys(weights)[0];
    }

    // --- Export / Import implementation ---
    function exportData(fileName) {
        // For each performer, increment performed if they were assigned at least once this session, else decrement.
        // Then export performers and projects (characters only — no assignments).
        const currentTime = Date.now();
        const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

        // Check if last update was 24+ hours ago
        const canDecrement = !lastUpdated || (currentTime - lastUpdated) >= TWENTY_FOUR_HOURS;

        const outPerformers = [];
        for (const id in performers) {
            const p = performers[id];
            let newPerformed = p.performed;

            if (p.everAssignedThisSession) {
                // Performer was assigned a role today
                const canIncrement = !p.lastPerformed || (currentTime - p.lastPerformed) >= TWENTY_FOUR_HOURS;
                if (canIncrement) {
                    newPerformed = clamp(p.performed + 1, 0, 9);
                    p.lastPerformed = currentTime; // Update internal state
                }
            } else if (canDecrement) {
                // Performer wasn't assigned and we can decrement (24+ hours since last update)
                newPerformed = clamp(p.performed - 1, 0, 9);
            }

            p.performed = newPerformed; // update internal state
            outPerformers.push({ name: p.name, gender: p.gender, performed: p.performed, lastPerformed: p.lastPerformed || 0 });
        }

        lastUpdated = currentTime; // Update global lastUpdated

        const outProjects = projects.map(proj => ({
            name: proj.name,
            characters: proj.characters.map(c => ({ name: c.name, gender: c.gender }))
        }));

        const saveDate = Date.now();
        if(!loadedFileName) {
            loadedFileName = fileName;
            loadedFileSaveDate = new Date(parseInt(saveDate));
        }
        const blob = new Blob([JSON.stringify({ saveDate: saveDate, lastUpdated: lastUpdated, performers: outPerformers, projects: outProjects, settings: settings }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        renderAll();
    }

    function loadData(data) {
        if (!data || !Array.isArray(data.performers) || !Array.isArray(data.projects)) {
            alert('Invalid data format. Expected { performers: [...], projects: [...] }');
            return;
        }
        // clear everything
        for (const id in performers) delete performers[id];
        extras.clear();
        projects.length = 0;
        performerIdCounter = 1;
        projectIdCounter = 1;
        characterIdCounter = 1;
        currentProjectId = null;
        // load lastUpdated
        lastUpdated = data.lastUpdated || 0;
        // load performers
        for (const p of data.performers) {
            // validate fields
            const name = String(p.name || '').trim();
            if (!name) continue;
            const gender = (p.gender === 'F') ? 'F' : 'M';
            const performed = clamp(parseInt(p.performed || 0, 10) || 0, 0, 9);
            const lastPerformed = p.lastPerformed || 0;
            newPerformer(name, gender, performed, lastPerformed);
        }
        // load projects and characters
        for (const pr of data.projects) {
            const projId = newProject(pr.name || `Project ${projects.length + 1}`);
            if (Array.isArray(pr.characters)) {
                for (const ch of pr.characters) {
                    const name = String(ch.name || '').trim();
                    if (!name) continue;
                    const gender = (ch.gender === 'F') ? 'F' : 'M';
                    newCharacter(projId, name, gender);
                }
            }
        }
        // load settings
        if (data.settings) {
            settings.separateMF = Boolean(data.settings.separateMF);
        } else {
            settings.separateMF = false;
        }
        // Update checkbox to match loaded settings
        const checkbox = $('#separate-mf-toggle');
        if (checkbox) checkbox.checked = settings.separateMF;
        // ensure a currentProjectId
        if (!currentProjectId && projects.length) currentProjectId = projects[0].id;
        renderAll();
    }

    // --- Misc helpers ---
    function escapeHtml(s) { return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": "&#039;" }[m])); }

    // Delete keyboard handlers for assigned performer remove button inside character inline
    document.addEventListener('click', (e) => {
        const remove = e.target.closest('[data-action="remove-assignment"]');
        if (remove) {
            const card = e.target.closest('.character-card');
            if (!card) return;
            const charId = card.dataset.charId;
            const proj = findProjectByCharacter(charId);
            if (!proj) return;
            const ch = proj.characters.find(c => c.id === charId);
            if (!ch) return;
            if (ch.assigned) {
                extras.add(ch.assigned);
                ch.assigned = null;
                renderAll();
            }
        }
    });

    // File-load reset helper
    window.loadDataFromObject = loadData; // for dev testing

    // Initialize DnD for dynamic elements: delegate dragstart from document
    document.addEventListener('dragstart', (ev) => {
        const el = ev.target.closest('[draggable="true"][data-id]');
        if (el) {
            ev.dataTransfer.setData('text/plain', el.dataset.id);
        }
    });

    // Global dropzones
    setupGlobalDnD();

    // initial render
    renderAll();

    // Expose small debug functions in console
    window.appState = {
        performers, projects, extras,
        renderAll,
        moveToExtras,
        randomAssign,
        swapAssign
    };

})();
