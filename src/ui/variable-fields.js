import { variableConfigs, codeBlocks, syncGroups, syncColorMap, currentFilter, currentSort, templateOrder, setCurrentFilter, setCurrentSort, saveState, saveUiState, restoreUiState } from '../state.js';
import { sanitizeId, escapeHTML, getDisplayVariableName } from '../utils.js';
import { getEditorInstance } from './editor.js';
import { triggerResultGeneration, processTemplateAndExtractVariables } from '../core.js';
import { openCustomTagModal } from './modal.js';

const textInputHistory = new WeakMap();
let blockVarNames = new Set(); // [수정] 모듈 스코프로 이동

function assignSyncGroupColors() {
    const currentValidGroups = new Map();
    Object.keys(variableConfigs).forEach(name => {
        const cfg = variableConfigs[name];
        if (cfg.mode === 'dropdown' && cfg.syncWith && cfg.syncWith.length > 0) {
            const groupMembers = [name, ...cfg.syncWith].sort();
            const groupKey = groupMembers.join(',');
            if (!currentValidGroups.has(groupKey)) {
                currentValidGroups.set(groupKey, groupMembers);
            }
        }
    });

    Object.keys(syncGroups).forEach(groupKey => {
        const members = groupKey.split(',');
        const isValidGroup = members.length >= 2 && members.every(m =>
            variableConfigs[m]?.mode === 'dropdown' &&
            members.filter(other => other !== m).every(other => variableConfigs[m].syncWith.includes(other))
        );
        if (!isValidGroup) {
            if (!currentValidGroups.has(groupKey)) {
                delete syncGroups[groupKey];
            }
        }
    });
    const colors = [
        '#fdba74', '#86efac', '#93c5fd', '#f9a8d4',
        '#a5b4fc', '#fcd34d', '#6ee7b7', '#c4b5fd'
    ];

    currentValidGroups.forEach((members, groupKey) => {
        if (!syncGroups[groupKey]) {
            syncGroups[groupKey] = {
                createdAt: syncGroups[groupKey]?.createdAt || Date.now()
            };
        }
    });

    const sortedGroupKeys = Object.keys(syncGroups).sort((a, b) => syncGroups[a].createdAt - syncGroups[b].createdAt);
    sortedGroupKeys.forEach((key, index) => {
        const group = syncGroups[key];
        group.name = `그룹 ${index + 1}`;
        group.color = colors[index % colors.length];
    });

    Object.keys(variableConfigs).forEach(name => {
        const group = [name, ...(variableConfigs[name].syncWith || [])].sort();
        const groupKey = group.join(',');
        if (syncGroups[groupKey]) {
            syncColorMap[name] = { key: groupKey, ...syncGroups[groupKey] };
        } else {
            delete syncColorMap[name];
        }
    });
}

export function applyFilterAndSort(originalOrder) {
    let sortedVariables;
    const [sortType, sortOrder] = currentSort.split('_');

    if (sortType !== 'default') {
        sortedVariables = [...originalOrder];
        sortedVariables.sort((a, b) => {
            let compareResult = 0;
            if (sortType === 'group') {
                const groupA = syncColorMap[a];
                const groupB = syncColorMap[b];
                const groupAExists = !!groupA;
                const groupBExists = !!groupB;

                if (groupAExists !== groupBExists) {
                    compareResult = groupAExists ? -1 : 1;
                } else if (groupAExists && groupBExists && groupA.key !== groupB.key) {
                    compareResult = syncGroups[groupA.key].createdAt - syncGroups[groupB.key].createdAt;
                }
            }
            if (compareResult === 0) {
                compareResult = a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' });
            }
            return sortOrder === 'asc' ? compareResult : -compareResult;
        });
    } else {
        sortedVariables = originalOrder;
    }

    const filteredVariables = sortedVariables.filter(name => {
        if (currentFilter === 'all') return true;
        if (currentFilter === 'text' || currentFilter === 'dropdown') {
            return variableConfigs[name]?.mode === currentFilter;
        }
        return syncColorMap[name]?.key === currentFilter;
    });

    renderVariableFields(filteredVariables);

    document.querySelectorAll('.toc-controls button').forEach(btn => {
        btn.classList.remove('active');
        const filterValue = btn.dataset.groupKey || btn.dataset.filter;
        if (filterValue === currentFilter || btn.dataset.sort === currentSort) {
            btn.classList.add('active');
        }
    });

    document.querySelectorAll('.toc-controls button[data-sort-type]').forEach(btn => {
        const btnSortType = btn.dataset.sortType;
        const [currentSortType, currentSortOrder] = currentSort.split('_');
        const baseText = btnSortType === 'group' ? '그룹순' : '이름순';

        if (btnSortType === currentSortType) {
            btn.classList.add('active');
            btn.textContent = `${baseText} ${currentSortOrder === 'asc' ? '▲' : '▼'}`;
        } else {
            btn.classList.remove('active');
            btn.textContent = baseText;
        }
    });
}

function calculateTwoLinesHeight(tocElement) {
    if (!tocElement.firstElementChild) return 0;
    const wasCollapsed = tocElement.classList.contains('is-collapsed');
    if (wasCollapsed) tocElement.classList.remove('is-collapsed');

    const firstItem = tocElement.firstElementChild;
    const itemHeight = firstItem.offsetHeight;
    const rowGap = parseFloat(getComputedStyle(tocElement).rowGap) || 8;

    if (wasCollapsed) tocElement.classList.add('is-collapsed');
    return (2 * itemHeight) + rowGap;
}

/**
 * 변수 목차(TOC)의 높이를 계산하여 내용이 2줄을 초과할 경우 '더 보기' 버튼을 표시하고 접기/펼치기 기능을 관리합니다.
 * 창 크기 조절 시에도 호출되어 반응형으로 동작합니다.
 * @param {HTMLElement} tocElement - 목차 컨테이너 요소
 */
export function manageTocCollapse(tocElement) {
    if (tocElement.classList.contains('is-expanded')) return;

    let toggleBtn = tocElement.querySelector('.toc-toggle-btn');
    if (!toggleBtn) {
        toggleBtn = document.createElement('button');
        toggleBtn.className = 'toc-toggle-btn';
        tocElement.appendChild(toggleBtn);

        toggleBtn.addEventListener('click', () => {
            if (tocElement.classList.contains('is-collapsed')) {
                tocElement.classList.remove('is-collapsed');
                tocElement.classList.add('is-expanded');
                toggleBtn.textContent = '접기 ▲';

                const onTransitionEnd = () => {
                    tocElement.classList.add('is-expanded');
                    tocElement.removeEventListener('transitionend', onTransitionEnd);
                };
                tocElement.addEventListener('transitionend', onTransitionEnd);

            } else {
                const twoLinesHeight = calculateTwoLinesHeight(tocElement);
                tocElement.classList.add('is-collapsed');
                tocElement.classList.remove('is-expanded');
                toggleBtn.textContent = '더 보기 ▼';
                tocElement.style.maxHeight = tocElement.scrollHeight + 'px';
                tocElement.getBoundingClientRect();
                tocElement.style.maxHeight = twoLinesHeight + 'px';
            }
        });
    }

    tocElement.style.transition = 'none';
    tocElement.classList.remove('is-collapsed');
    tocElement.classList.remove('is-expanded');
    tocElement.style.maxHeight = '';
    if (toggleBtn) toggleBtn.style.display = 'none';

    if (!tocElement.firstElementChild) return;

    // 정확한 높이 계산을 위해 브라우저가 리플로우를 수행하도록 강제합니다.
    tocElement.getBoundingClientRect();

    const twoLinesHeight = calculateTwoLinesHeight(tocElement);
    const totalHeight = tocElement.scrollHeight;

    if (totalHeight > twoLinesHeight + 5) {
        tocElement.classList.add('is-collapsed');
        tocElement.style.maxHeight = calculateTwoLinesHeight(tocElement) + 'px';
        toggleBtn.textContent = '더 보기 ▼';
        toggleBtn.style.display = 'inline-block';
    }
    tocElement.style.transition = '';
}

function getBlockVariables() {
    const blockVars = new Map(); // blockId -> Set of var names
    const tpl = getEditorInstance()?.getValue() || '';
    const blockInstanceRegex = /<!-- START: (.+?) -->/g;
    let match;
    while ((match = blockInstanceRegex.exec(tpl)) !== null) {
        const instanceId = match[1];
        const [blockId, ..._] = instanceId.split('_instance_');
        if (!blockVars.has(blockId)) {
            blockVars.set(blockId, new Set());
        }
        const varRegex = new RegExp(`{{\\s*(${escapeHTML(blockId)}_[^\\s{}]+)\\s*}}`, 'g');
        let varMatch;
        while ((varMatch = varRegex.exec(tpl)) !== null) {
            if (varMatch[1].startsWith(instanceId)) {
                blockVars.get(blockId).add(varMatch[1]);
            }
        }
    }
    return blockVars;
}

function renderVariableFields(variables) {
    const container = document.getElementById('variableFields');
    container.innerHTML = '';
    const totalVarCount = Object.keys(variableConfigs).length;

    assignSyncGroupColors();
    const blockVariables = getBlockVariables();
    blockVarNames.clear(); // [수정] 렌더링 시마다 Set을 초기화
    blockVariables.forEach(varSet => {
        varSet.forEach(varName => blockVarNames.add(varName));
    });

    // [추가] 중복된 표시 이름을 가진 변수들을 찾아 색상을 할당합니다.
    const duplicateColorMap = {};
    const displayNameCounts = {};
    variables.forEach(name => {
        const displayName = getDisplayVariableName(name, blockVarNames);
        displayNameCounts[displayName] = (displayNameCounts[displayName] || 0) + 1;
    });

    const duplicateDisplayNames = Object.keys(displayNameCounts).filter(name => displayNameCounts[name] > 1);
    if (duplicateDisplayNames.length > 0) {
        const colors = ['#e11d48', '#db2777', '#9333ea', '#6d28d9', '#4f46e5', '#2563eb', '#0284c7', '#0d9488', '#15803d', '#65a30d', '#ca8a04', '#d97706', '#ea580c'];
        let colorIndex = 0;
        duplicateDisplayNames.forEach(displayName => {
            // [수정] 중복된 이름을 가진 변수 그룹을 templateOrder 순서대로 정렬합니다.
            const duplicates = variables
                .filter(fullName => getDisplayVariableName(fullName, blockVarNames) === displayName)
                .sort((a, b) => templateOrder.indexOf(a) - templateOrder.indexOf(b));
            // [수정] 첫 번째(원본)를 제외한 나머지 중복 변수들에 각각 다른 색상을 할당합니다.
            duplicates.slice(1).forEach(fullName => {
                duplicateColorMap[fullName] = colors[colorIndex % colors.length];
                colorIndex++; // 각 변수마다 다른 색상을 위해 인덱스를 증가시킵니다.
            });
        });
    }

    // [수정] core.js에서 변수 목록이 정리되었으므로, 이름으로 간단히 분류합니다.
    const regularVariables = variables.filter(name => !blockVarNames.has(name));

    const renderVariables = (vars, parent) => {
        vars.forEach(name => {
            if (!variableConfigs[name]) {
                variableConfigs[name] = { mode: 'text', options: [], default: '', syncWith: [] };
            }
            const field = createVariableField(name, variableConfigs[name], duplicateColorMap[name]);
            parent.appendChild(field);
        });
    };

    const hasVariables = regularVariables.length > 0 || Array.from(blockVariables.keys()).length > 0;

    if (totalVarCount >= 5) {
        const controls = document.createElement('div');
        controls.className = 'toc-controls';

        // 변수가 있을 때만 컨트롤 표시
        if (hasVariables) {
            controls.innerHTML = `
            <div class="filter-group">
                <button data-filter="all">전체</button>
                <button data-filter="text">텍스트</button>
                <button data-filter="dropdown">드롭다운</button>
            </div>
            <div class="filter-group">
                ${Object.keys(syncColorMap).length > 0 ? `<button data-sort-type="group" class="secondary">그룹순</button>` : ''}
                <button data-sort-type="name" class="secondary">이름순</button>
            </div>
        `;
        }

       container.appendChild(controls);

        const groupFilterContainer = controls.querySelector('.filter-group');
        if (Object.keys(syncColorMap).length > 0) {
            const groupFilters = document.createElement('div');
            groupFilters.className = 'filter-group';
            groupFilters.style.cssText = 'border-left: 1px solid var(--border-color); padding-left: 8px;';
            Object.values(syncColorMap)
                .filter((v, i, a) => a.findIndex(t => t.key === v.key) === i)
                .sort((a, b) => syncGroups[a.key].createdAt - syncGroups[b.key].createdAt)
                .forEach(group => {
                    groupFilters.innerHTML += `<button data-filter="${group.key}" data-group-key="${group.key}" class="secondary" style="--sync-color: ${group.color}; background-color: var(--sync-color); color: #1f2937;">${group.name}</button>`;
                });
            groupFilterContainer.appendChild(groupFilters);
        }

        controls.addEventListener('click', (e) => {
            const target = e.target.closest('button');
            if (!target) return;

            if (target.dataset.filter) {
                setCurrentFilter(target.dataset.groupKey || target.dataset.filter);
            }
            if (target.dataset.sortType) {
                const sortType = target.dataset.sortType;
                const [currentSortType, currentSortOrder] = currentSort.split('_');
                let newSort;

                if (currentSortType !== sortType) {
                    newSort = `${sortType}_asc`;
                } else {
                    if (currentSortOrder === 'asc') newSort = `${sortType}_desc`;
                    else newSort = 'default'; // desc 다음은 default
                }
                setCurrentSort(newSort);
            }
            processTemplateAndExtractVariables();
        });

        const toc = document.createElement('div');
        toc.className = 'toc';
        if (variables.length === 0) {
            toc.innerHTML = `<span class="hint">"${currentFilter}" 필터에 해당하는 변수가 없습니다.</span>`;
        }

        // [수정] 필터링된 전체 변수 목록을 사용하되, 표시 이름은 짧게 하여 중복 문제를 해결합니다.
        variables.forEach(name => {
            const link = document.createElement('a');
            link.href = `#var-field-${sanitizeId(name)}`;
            link.textContent = getDisplayVariableName(name, blockVarNames); // blockVarNames를 전달해야 합니다.

            // [추가] 목차의 링크에도 중복 변수 색상 하이라이트를 적용합니다.
            const duplicateColor = duplicateColorMap[name];
            if (duplicateColor) {
                link.classList.add('duplicate-variable-highlight');
                link.style.setProperty('--duplicate-color', duplicateColor);
            }
            toc.appendChild(link);
        });

        toc.addEventListener('click', (e) => {
            if (e.target.tagName === 'A' && e.target.hash) {
                e.preventDefault(); // 기본 해시 이동 동작 방지
                const targetElement = document.querySelector(e.target.hash);
                if (targetElement) {
                    const wrapper = document.getElementById('variables-content-wrapper');
                    const isCollapsed = wrapper.classList.contains('is-collapsed');

                    if (isCollapsed && getComputedStyle(targetElement).display === 'none') {
                        wrapper.classList.remove('is-collapsed');
                    }
                    if (targetElement.tagName === 'DETAILS') {
                        targetElement.open = true;
                    }
                    // 스크롤 후 하이라이트 효과 적용
                    const observer = new IntersectionObserver((entries, obs) => {
                        entries.forEach(entry => {
                            if (entry.isIntersecting) {
                                // [추가] 스크롤 시작과 함께 모든 변수 필드의 마우스 이벤트를 비활성화합니다.
                                const fieldsContainer = document.getElementById('variableFields');
                                if (fieldsContainer) fieldsContainer.classList.add('pointer-events-none');

                                // 모든 그룹 하이라이트를 일시 중지하여 바로가기 효과와의 충돌을 방지합니다.
                                document.querySelectorAll('.sync-group-highlight.is-hovered').forEach(el => {
                                    el.classList.remove('is-hovered');
                                });

                                const targetVarName = targetElement.id.replace('var-field-', '');
                                const groupInfo = syncColorMap[targetVarName];
                                if (groupInfo) {
                                    document.querySelectorAll(`.sync-group-highlight[data-group-key="${groupInfo.key}"]`).forEach(el => {
                                        el.classList.add('group-highlight-paused');
                                    });
                                }

                                targetElement.classList.add('is-highlighted');
                                setTimeout(() => {
                                    targetElement.classList.remove('is-highlighted');
                                    if (groupInfo) {
                                        const groupElements = document.querySelectorAll(`.sync-group-highlight[data-group-key="${groupInfo.key}"]`);
                                        groupElements.forEach(el => {
                                            el.classList.remove('group-highlight-paused');
                                        });

                                        const hoveredElement = Array.from(groupElements).find(el => el.matches(':hover'));
                                        if (hoveredElement) {
                                            document.querySelectorAll('.sync-group-highlight.is-hovered').forEach(el => el.classList.remove('is-hovered'));
                                            hoveredElement.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                                        }
                                    }
                                    if (fieldsContainer) {
                                        fieldsContainer.classList.remove('pointer-events-none');
                                    }
                                }, 1200); // 애니메이션 지속 시간(1.2초)과 일치

                                obs.unobserve(targetElement); // 목적 달성 후 관찰 중지
                            }
                        });
                    }, {
                        root: null, // viewport 기준
                        threshold: 0.9 // 90% 이상 보일 때 콜백 실행
                    });

                    observer.observe(targetElement);
                    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        });

        container.appendChild(toc);
        manageTocCollapse(toc);
    }

    // Render regular variables
    renderVariables(regularVariables, container);

    // Render block variables
    blockVariables.forEach((varSet, blockId) => {
        const blockName = codeBlocks[blockId]?.name || blockId;
        const group = document.createElement('div');
        group.className = 'variable-group';
        group.id = `variable-group-${sanitizeId(blockId)}`; // [추가] 목차에서 링크할 ID
        group.innerHTML = `
            <div class="variable-group-header">
                <span>코드 블록: ${escapeHTML(blockName)}</span>
            </div>
        `;
        // [수정] 템플릿에 정의된 순서(templateOrder)를 기준으로 변수를 정렬합니다.
        const varsForBlock = Array.from(varSet).filter(v => variables.includes(v));
        const sortedVars = varsForBlock.sort((a, b) => templateOrder.indexOf(a) - templateOrder.indexOf(b));
        
        // 그룹 내 변수들을 렌더링하여 그룹에 추가
        const varContainer = document.createElement('div');
        renderVariables(sortedVars, varContainer);
        group.appendChild(varContainer);

        // [수정] 그룹 내에 렌더링할 변수가 있을 때만 그룹을 추가합니다.
        if (sortedVars.length > 0) {
            container.appendChild(group);
        }
    });


    // '펼치기' 기능이 4번째가 아닌, 일반 변수 중 4번째에 적용되도록 수정
    const regularFields = container.querySelectorAll('details.field:not(.variable-group details.field)');
    const fourthField = regularFields.length >= 4 ? regularFields[3] : null;

    if (fourthField) {
        fourthField.addEventListener('toggle', () => {
            const wrapper = document.getElementById('variables-content-wrapper');
            if (wrapper.classList.contains('is-collapsed') && fourthField.open) {
                wrapper.classList.remove('is-collapsed');
                updateCollapseUI(variables.length);
            }
        }, true);
    }
}

function createVariableField(name, cfg, duplicateColor) {
    const field = document.createElement('details');
    field.className = 'field';
    field.id = `var-field-${sanitizeId(name)}`;

    // [추가] 중복 이름 하이라이트 적용
    if (duplicateColor) {
        field.classList.add('duplicate-variable-highlight');
        field.style.setProperty('--duplicate-color', duplicateColor);
    }

    const label = document.createElement('summary');
    label.textContent = getDisplayVariableName(name, blockVarNames);
    const modeTag = document.createElement('span');
    modeTag.style.cssText = 'font-size: 11px; font-weight: normal; padding: 2px 6px; border-radius: 4px; margin-left: 8px; vertical-align: middle;';

    if (cfg.mode === 'dropdown') {
        modeTag.textContent = '드롭다운';
        modeTag.style.background = '#dbeafe';
        modeTag.style.color = '#1e40af';
    } else {
        modeTag.textContent = '텍스트';
        modeTag.style.background = '#e5e7eb';
        modeTag.style.color = '#4b5563';
    }
    label.appendChild(modeTag);

    if (syncColorMap[name]) {
        const groupTag = document.createElement('span');
        groupTag.className = 'sync-group-tag';
        groupTag.textContent = syncColorMap[name].name;
        groupTag.style.setProperty('--sync-color', syncColorMap[name].color);
        label.appendChild(groupTag);

        const resetBtn = document.createElement('span');
        resetBtn.className = 'sync-group-reset-btn';
        resetBtn.textContent = '[x]';
        resetBtn.title = `${syncColorMap[name].name} 동기화 모두 해제`;
        resetBtn.dataset.groupKey = syncColorMap[name].key;

        resetBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const groupKeyToReset = e.target.dataset.groupKey;
            Object.keys(syncColorMap).forEach(varName => {
                if (syncColorMap[varName].key === groupKeyToReset) {
                    variableConfigs[varName].syncWith = [];
                }
            });
            processTemplateAndExtractVariables();
            saveState();
        });
        label.appendChild(resetBtn);
    }
    field.appendChild(label);

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'field-content';

    const modeSel = createModeSelector(name, cfg);
    const textWrap = createTextInput(name, cfg);
    const dropWrap = createDropdownControls(name, cfg);

    contentWrapper.appendChild(modeSel);
    contentWrapper.appendChild(textWrap);
    contentWrapper.appendChild(dropWrap);
    field.appendChild(contentWrapper);

    modeSel.addEventListener('change', (e) => {
        cfg.mode = e.target.value;

        if (cfg.mode === 'text') {
            const oldSyncGroup = [...cfg.syncWith];
            oldSyncGroup.forEach(syncedVarName => {
                const syncedVarCfg = variableConfigs[syncedVarName];
                if (syncedVarCfg) {
                    syncedVarCfg.syncWith = syncedVarCfg.syncWith.filter(v => v !== name);
                }
            });
            cfg.syncWith = [];
            assignSyncGroupColors();
        }
        const oldGroupKey = [name, ...cfg.syncWith].sort().join(',');
        if (syncGroups[oldGroupKey]) {
            delete syncGroups[oldGroupKey];
        }

        textWrap.style.display = cfg.mode === 'text' ? 'block' : 'none';
        dropWrap.style.display = cfg.mode === 'dropdown' ? 'block' : 'none';
        const modeTag = label.querySelector('span');
        if (modeTag) {
            if (cfg.mode === 'dropdown') {
                modeTag.textContent = '드롭다운';
                modeTag.style.background = '#dbeafe';
                modeTag.style.color = '#1e40af';
            } else {
                modeTag.textContent = '텍스트';
                modeTag.style.background = '#e5e7eb';
                modeTag.style.color = '#4b5563';
            }
        }
        // UI 상태를 저장하고, processTemplateAndExtractVariables를 호출하여 UI를 다시 렌더링합니다.
        // processTemplateAndExtractVariables는 내부적으로 'uiNeedsUpdate' 이벤트를 발생시킵니다.
        saveUiState();
        processTemplateAndExtractVariables();
        restoreUiState();
    });

    if (syncColorMap[name]) {
        field.classList.add('sync-group-highlight');
        field.style.setProperty('--sync-color', syncColorMap[name].color);

        field.addEventListener('mouseenter', () => {
            // [수정] 바로가기 하이라이트가 활성화되어 있지 않을 때만 그룹 하이라이트를 적용합니다.
            if (field.classList.contains('is-highlighted') || field.classList.contains('group-highlight-paused')) {
                return;
            }
            const groupKey = syncColorMap[name].key;
            Object.keys(syncColorMap).forEach(varName => {
                if (syncColorMap[varName].key === groupKey) {
                    document.getElementById(`var-field-${sanitizeId(varName)}`)?.classList.add('is-hovered');
                }
            });
        });

        field.addEventListener('mouseleave', () => {
            document.querySelectorAll('.sync-group-highlight.is-hovered').forEach(el => {
                el.classList.remove('is-hovered');
            });
        });
    }

    return field;
}

function createModeSelector(name, cfg) {
    const wrapper = document.createElement('div');
    const selectId = `mode-select-${sanitizeId(name)}`;

    const label = document.createElement('label');
    label.htmlFor = selectId;
    label.className = 'visually-hidden';
    label.textContent = `${name} 변수 타입 선택`;

    const sel = document.createElement('select');
    sel.id = selectId;
    sel.innerHTML = `<option value="text">텍스트 입력</option><option value="dropdown">드롭다운</option>`;
    sel.value = cfg.mode;

    wrapper.append(label, sel); // wrapper는 레이블과 셀렉트를 감싸는 역할만 합니다.
    return sel; // 셀렉트 요소만 반환합니다.
}

function createTextInput(name, cfg) {
    const wrap = document.createElement('div');
    wrap.style.marginTop = '8px';
    wrap.style.display = cfg.mode === 'text' ? 'block' : 'none';

    
    const input = document.createElement('textarea');
    input.className = 'auto-height-textarea';
    input.id = sanitizeId(name) + '_text';
    input.placeholder = name + ' 값 입력';
    input.value = cfg.default || '';
    input.rows = 1;

    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.className = 'visually-hidden';
    label.textContent = `${name} 값 입력`;

    const autoResizeTextarea = (el) => {
        el.style.height = 'auto';
        el.style.height = (el.scrollHeight) + 'px';
    };

    setTimeout(() => autoResizeTextarea(input), 0);

    saveHistory(input, input.value);

    input.addEventListener('input', (e) => {
        cfg.default = e.target.value;
        saveHistory(e.target, e.target.value);
        autoResizeTextarea(e.target);
        saveState();
        triggerResultGeneration();
    });

    input.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            undoLastChange(e.target);
            autoResizeTextarea(e.target);
        }
    });

    const toolbar = document.createElement('div');
    toolbar.className = 'text-format-toolbar';
    toolbar.innerHTML = `
        <button name="format-bold" data-tag="b" title="굵게 (Ctrl+B)">B</button>
        <button name="format-italic" data-tag="i" title="기울임 (Ctrl+I)">I</button>
        <button name="format-link" data-tag="a" title="링크 삽입">Link</button>
        <button name="format-custom" data-tag="custom" title="커스텀 태그">Custom</button>
    `;

    toolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const tag = btn.dataset.tag;
        if (tag === 'custom') {
            openCustomTagModal(input);
            return;
        }
        let attribute = '';
        if (tag === 'a') {
            const url = prompt('연결할 URL을 입력하세요:', 'https://');
            if (!url) return;
            attribute = ` href="${escapeHTML(url)}"`;
        }
        wrapTextWithTag(input, tag, attribute);
        autoResizeTextarea(input);
    });
    // [수정] 접근성 레이블이 textarea 위에 공간을 차지하지 않도록 input과 toolbar 뒤에 추가합니다.
    wrap.append(input, toolbar, label);
    return wrap;
}

function saveHistory(inputElement, value) {
    if (!textInputHistory.has(inputElement)) {
        textInputHistory.set(inputElement, []);
    }
    const history = textInputHistory.get(inputElement);
    if (history[history.length - 1] === value) return;

    history.push(value);
    if (history.length > 20) {
        history.shift();
    }
}

function undoLastChange(inputElement) {
    const history = textInputHistory.get(inputElement);
    if (!history || history.length <= 1) return;

    history.pop();
    inputElement.value = history[history.length - 1];
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
}

function wrapTextWithTag(inputElement, tagName, attributes = '') {
    const start = inputElement.selectionStart;
    const end = inputElement.selectionEnd;
    const text = inputElement.value;
    const selectedText = text.substring(start, end);

    const openTag = `<${tagName}${attributes}>`;
    const closeTag = `</${tagName}>`;

    let newText;
    let newCursorPos;

    if (selectedText) {
        newText = `${text.substring(0, start)}${openTag}${selectedText}${closeTag}${text.substring(end)}`;
        newCursorPos = end + openTag.length + closeTag.length;
    } else {
        newText = `${text.substring(0, start)}${openTag}${closeTag}${text.substring(end)}`;
        newCursorPos = start + openTag.length;
    }

    inputElement.value = newText;
    inputElement.focus();
    inputElement.setSelectionRange(newCursorPos, newCursorPos);
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
}

function createDropdownControls(name, cfg) {
    const wrap = document.createElement('div');
    wrap.style.marginTop = '8px';
    wrap.style.display = cfg.mode === 'dropdown' ? 'block' : 'none';

    const optionsRow = document.createElement('div');
    optionsRow.className = 'options-row';

    const newOptNameInput = document.createElement('input');
    newOptNameInput.type = 'text';
    newOptNameInput.id = `new-opt-name-${sanitizeId(name)}`; // [추가] 고유 ID 부여
    newOptNameInput.placeholder = '옵션 이름 (보여주기용)';

    const newOptValueInput = document.createElement('input');
    newOptValueInput.type = 'text';
    newOptValueInput.id = `new-opt-value-${sanitizeId(name)}`; // [추가] 고유 ID 부여
    newOptValueInput.placeholder = '옵션 값 (실제 값)';

    const addBtn = document.createElement('button');
    addBtn.textContent = '추가';

    const clearAllBtn = document.createElement('button');
    clearAllBtn.textContent = '전체 삭제';
    clearAllBtn.className = 'warning';

    optionsRow.append(newOptNameInput, newOptValueInput, addBtn, clearAllBtn);

    const sel = document.createElement('select');
    sel.id = sanitizeId(name) + '_select';
    sel.style.cssText = 'margin-top: 8px; width: 100%; box-sizing: border-box;';

    const chips = document.createElement('div');
    chips.id = sanitizeId(name) + '_chips';
    chips.style.marginTop = '8px';

    wrap.append(optionsRow, sel, chips);

    const addOptionAction = () => {
        const optName = (newOptNameInput.value || '').trim();
        const optValue = (newOptValueInput.value || '').trim();
        if (!optValue) {
            alert('옵션 값은 비워둘 수 없습니다.');
            return;
        }
        if (cfg.options.some(o => o.value === optValue)) {
            alert('동일한 옵션 값이 이미 존재합니다.');
            return;
        }

        cfg.options.push({ name: optName || optValue, value: optValue });
        cfg.default = optValue;
        populateOptionsFor(name, sel, chips, true);
        newOptNameInput.value = '';
        newOptValueInput.value = '';
        saveState();
    };

    addBtn.addEventListener('click', addOptionAction);
    newOptValueInput.addEventListener('keydown', e => e.key === 'Enter' && addOptionAction());

    clearAllBtn.addEventListener('click', () => {
        if (cfg.options.length > 0 && confirm(`'${name}' 변수의 모든 옵션을 삭제하시겠습니까?`)) {
            cfg.options = [];
            cfg.default = '';
            saveState();
            populateOptionsFor(name, sel, chips, true);
            saveState();
            triggerResultGeneration();
        }
    });

    sel.addEventListener('change', (e) => {
        cfg.default = e.target.value;
        syncDropdownSelection(name);
        saveState();
        triggerResultGeneration();
    });

    populateOptionsFor(name, sel, chips, false);
    if (!chips.dataset.isDndInitialized) {
        initializeDragAndDrop(chips, name, cfg, sel);
        chips.dataset.isDndInitialized = 'true';
    }
    const syncWrap = createSyncSelector(name, cfg);
    wrap.appendChild(syncWrap);

    return wrap;
}

function createSyncSelector(currentVarName, cfg) {
    const wrapper = document.createElement('div');
    wrapper.className = 'sync-checkbox-wrapper';
    wrapper.style.display = cfg.mode === 'dropdown' ? 'block' : 'none';

    const titleLabel = document.createElement('span'); // [수정] label 대신 span 태그를 사용하여 접근성 경고를 해결합니다.
    titleLabel.textContent = '옵션 동기화';
    titleLabel.style.fontSize = '13px'; // 스타일은 그대로 유지합니다.
    titleLabel.style.color = 'var(--hint-color)';

    const listContainer = document.createElement('div');
    listContainer.className = 'sync-checkbox-list';

    const currentSyncGroupKey = (syncColorMap[currentVarName] || {}).key;

    if (Object.keys(variableConfigs).filter(v => v !== currentVarName && variableConfigs[v].mode === 'dropdown').length === 0) {
        const noOptionsHint = document.createElement('span');
        noOptionsHint.textContent = '동기화할 다른 드롭다운 변수가 없습니다.';
        noOptionsHint.className = 'hint';
        noOptionsHint.style.fontSize = '13px';
        listContainer.appendChild(noOptionsHint);
    }

    Object.keys(variableConfigs).forEach(otherName => {
        if (otherName !== currentVarName && variableConfigs[otherName].mode === 'dropdown') {
            const checkboxId = `sync-check-${sanitizeId(currentVarName)}-${sanitizeId(otherName)}`;
            const label = document.createElement('label');
            label.htmlFor = checkboxId;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = checkboxId;
            checkbox.value = otherName;
            checkbox.checked = cfg.syncWith && cfg.syncWith.includes(otherName);

            label.htmlFor = checkboxId; // [수정] label과 input을 명시적으로 연결합니다.
            const otherSyncGroupKey = (syncColorMap[otherName] || {}).key;
            if (currentSyncGroupKey && otherSyncGroupKey && otherSyncGroupKey !== currentSyncGroupKey) {
                checkbox.disabled = true;
                label.style.color = 'var(--hint-color)';
                label.title = `${otherName} 변수는 이미 다른 그룹과 동기화되어 있습니다.`;
            }

            checkbox.addEventListener('change', (e) => {
                const targetVar = e.target.value;
                const isChecked = e.target.checked;

                if (isChecked) {
                    const currentCfg = variableConfigs[currentVarName];
                    const targetCfg = variableConfigs[targetVar];
                    const currentGroup = [currentVarName, ...currentCfg.syncWith];
                    const targetGroup = [targetVar, ...targetCfg.syncWith];
                    const newFullGroup = Array.from(new Set([...currentGroup, ...targetGroup]));

                    let oldestCreatedAt = Date.now();
                    let oldestGroupKey = null;
                    [...currentGroup, ...targetGroup].forEach(member => {
                        const oldGroupKey = [member, ...variableConfigs[member].syncWith].sort().join(',');
                        if (syncGroups[oldGroupKey]) {
                            if (syncGroups[oldGroupKey].createdAt < oldestCreatedAt) {
                                oldestCreatedAt = syncGroups[oldGroupKey].createdAt;
                                oldestGroupKey = oldGroupKey;
                            }
                            delete syncGroups[oldGroupKey];
                        }
                    });

                    newFullGroup.forEach(memberVar => {
                        const memberCfg = variableConfigs[memberVar];
                        if (memberCfg) {
                            memberCfg.syncWith = newFullGroup.filter(v => v !== memberVar).sort();
                        }
                    });
                    const newGroupKey = newFullGroup.sort().join(',');
                    if (!syncGroups[newGroupKey]) {
                        syncGroups[newGroupKey] = {
                            createdAt: oldestCreatedAt
                        };
                    }
                } else {
                    const oldGroupMembers = [currentVarName, ...variableConfigs[currentVarName].syncWith];
                    const oldGroupKey = oldGroupMembers.sort().join(',');
                    const oldGroupInfo = syncGroups[oldGroupKey];

                    if (syncGroups[oldGroupKey]) {
                        delete syncGroups[oldGroupKey];
                    }

                    const remainingMembers = oldGroupMembers.filter(m => m !== targetVar);
                    remainingMembers.forEach(member => {
                        variableConfigs[member].syncWith = remainingMembers.filter(other => other !== member).sort();
                        const newSubGroup = [member, ...variableConfigs[member].syncWith];
                        if (newSubGroup.length >= 2) {
                            const newSubGroupKey = newSubGroup.sort().join(',');
                            syncGroups[newSubGroupKey] = oldGroupInfo || { createdAt: Date.now() };
                        }
                    });

                    const targetVarCfg = variableConfigs[targetVar];
                    targetVarCfg.syncWith = targetVarCfg.syncWith.filter(m => !remainingMembers.includes(m));

                    if (remainingMembers.length >= 2) {
                        const newSubGroup = remainingMembers.sort();
                        const newSubGroupKey = newSubGroup.join(',');
                        syncGroups[newSubGroupKey] = oldGroupInfo || { createdAt: Date.now() };
                    }
                }

                // UI 상태를 저장하고, processTemplateAndExtractVariables를 호출하여 UI를 다시 렌더링합니다.
                // processTemplateAndExtractVariables는 내부적으로 'uiNeedsUpdate' 이벤트를 발생시킵니다.
                saveUiState();
                processTemplateAndExtractVariables();
                restoreUiState(true);
                saveState();
            });

            label.appendChild(checkbox);
            label.append(` ${otherName}`);
            listContainer.appendChild(label);
        }
    });

    wrapper.append(titleLabel, listContainer);
    return wrapper;
}

function initializeDragAndDrop(chipsContainer, name, cfg, sel) {
    let draggedItem = null;
    let placeholder = null;

    chipsContainer.addEventListener('dragstart', (e) => {
        if (!e.target.classList.contains('chip')) return;
        draggedItem = e.target.closest('.chip');
        if (!draggedItem) return;

        placeholder = document.createElement('span');
        placeholder.className = 'chip placeholder';
        placeholder.style.height = draggedItem.offsetHeight + 'px';
        placeholder.style.width = draggedItem.offsetWidth + 'px';

        setTimeout(() => {
            draggedItem.classList.add('dragging');
        }, 0);
    });

    chipsContainer.addEventListener('dragend', (e) => {
        if (!draggedItem) return;
        draggedItem.classList.remove('dragging');
        if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.removeChild(placeholder);
        }
        draggedItem = null;
        placeholder = null;
    });

    chipsContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedItem) return;

        const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
        const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
        const afterElement = getDragAfterElement(chipsContainer, clientX, clientY);
        if (afterElement == null) {
            chipsContainer.appendChild(placeholder);
        } else {
            chipsContainer.insertBefore(placeholder, afterElement);
        }
    });

    chipsContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!draggedItem || !placeholder || !placeholder.parentNode) return;

        const draggedIndex = parseInt(draggedItem.dataset.index);
        let targetIndex = Array.from(chipsContainer.children).indexOf(placeholder);

        if (targetIndex !== -1 && draggedIndex !== targetIndex) {
            if (draggedIndex < targetIndex) {
                targetIndex--;
            }

            const itemToMove = cfg.options.splice(draggedIndex, 1)[0];
            cfg.options.splice(targetIndex, 0, itemToMove);

            populateOptionsFor(name, sel, chipsContainer, true);
            saveState();
        }
    });

    function getDragAfterElement(container, x, y) {
        const draggableElements = [...container.querySelectorAll('.chip:not(.dragging):not(.placeholder)')];

        const closest = draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const isInVerticalRange = y >= box.top && y <= box.bottom;

            if (isInVerticalRange) {
                const offset = x - box.left - box.width / 2;
                if (Math.abs(offset) < Math.abs(closest.offset)) {
                    return { offset: offset, element: child };
                }
            }
            return closest;
        }, { offset: Number.POSITIVE_INFINITY, element: null });

        if (closest.element === null) return null;

        return closest.offset < 0 ? closest.element : closest.element.nextSibling;
    }
}

function populateOptionsFor(name, selElement, chipsElement, triggerSync = false) {
    const cfg = variableConfigs[name];
    const sel = selElement || document.getElementById(sanitizeId(name) + '_select');
    const chips = chipsElement || document.getElementById(sanitizeId(name) + '_chips');
    if (!sel || !chips) return;

    sel.innerHTML = '';
    chips.innerHTML = '';

    if (cfg.options.length === 0) {
        const placeholder = document.createElement('option');
        placeholder.textContent = '(옵션을 추가해 주세요)';
        placeholder.disabled = true;
        placeholder.selected = true;
        placeholder.style.color = '#9ca3af';
        sel.appendChild(placeholder);
    }

    cfg.options.forEach((opt, index) => {
        const optionEl = document.createElement('option');
        optionEl.value = opt.value;
        optionEl.textContent = opt.name;
        sel.appendChild(optionEl);

        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.style.position = 'relative';
        chip.style.paddingRight = '24px';
        chip.draggable = true;
        chip.dataset.index = index;

        const deleteBtn = document.createElement('button');
        deleteBtn.title = '삭제';
        deleteBtn.innerHTML = '✕';
        deleteBtn.style.position = 'absolute';
        deleteBtn.style.top = '50%';
        deleteBtn.style.right = '4px';
        deleteBtn.style.transform = 'translateY(-50%)';
        deleteBtn.style.lineHeight = '1';

        chip.appendChild(deleteBtn);

        if (opt.name === opt.value) {
            const valueSpan = createChipSpan(opt, 'value', true);
            chip.insertBefore(valueSpan, deleteBtn);

        } else {
            const nameSpan = createChipSpan(opt, 'name');
            const arrowSpan = document.createElement('span');
            arrowSpan.textContent = '→';
            arrowSpan.style.color = '#9ca3af';
            const valueSpan = createChipSpan(opt, 'value');
            chip.insertBefore(nameSpan, deleteBtn);
            chip.insertBefore(arrowSpan, deleteBtn);
            chip.insertBefore(valueSpan, deleteBtn);
        }

        function createChipSpan(option, key, isOnlyValue = false) {
            const span = document.createElement('span');
            span.className = 'truncate';
            span.textContent = escapeHTML(option[key]);
            span.title = `더블클릭하여 ${key === 'name' ? '이름' : '값'} 수정`;
            span.style.cursor = 'pointer';

            if (key === 'name' || isOnlyValue) {
                span.style.background = 'var(--name-span-bg)';
                span.style.padding = '2px 6px';
                span.style.borderRadius = '4px';
                span.style.fontWeight = '500';
            } else {
                span.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace';
                span.style.color = 'var(--value-span-text)';
            }

            span.addEventListener('dblclick', () => makeEditable(span, key, isOnlyValue));
            return span;
        }

        const makeEditable = (span, key, isOnlyValue) => {
            const oldText = span.textContent;
            const oldVal = opt[key];
            const input = document.createElement('input');
            input.type = 'text';
            input.value = oldVal;
            span.style.display = 'none';

            const parentChip = span.closest('.chip');
            if (parentChip) parentChip.draggable = false;

            span.parentElement.insertBefore(input, span.nextSibling);
            input.focus();

            const saveChange = () => {
                const newVal = (input.value || '').trim();
                if (key === 'value' && !newVal) {
                    alert('값은 비워둘 수 없습니다.');
                    input.remove();
                    span.style.display = '';
                    return;
                }
                if (newVal && newVal !== oldVal) {
                    if (key === 'value' && cfg.options.some(o => o.value === newVal)) {
                        alert('동일한 값이 이미 존재합니다.');
                    } else {
                        opt[key] = newVal;
                        if (isOnlyValue) {
                            opt.name = newVal;
                        }
                        if (key === 'value' && cfg.default === oldVal) {
                            cfg.default = newVal;
                        }
                        saveState();
                    }
                }
                populateOptionsFor(name, sel, chips);
                if (parentChip) parentChip.draggable = true;
            };
            input.addEventListener('blur', saveChange);
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') input.blur();
                if (e.key === 'Escape') {
                    input.removeEventListener('blur', saveChange);
                    input.blur();
                    if (parentChip) parentChip.draggable = true;
                }
            });
        };

        deleteBtn.addEventListener('click', () => {
            cfg.options = cfg.options.filter(o => o.value !== opt.value);
            if (cfg.default === opt.value) cfg.default = cfg.options.length > 0 ? cfg.options[0].value : '';
            saveState();
            populateOptionsFor(name, sel, chips, true);
        });
        chips.appendChild(chip);
    });

    sel.value = cfg.default;
}

export function syncDropdownSelection(sourceVarName) {
    const sourceConfig = variableConfigs[sourceVarName];
    if (!sourceConfig || !sourceConfig.syncWith || sourceConfig.syncWith.length === 0) return;

    const selectedOption = sourceConfig.options.find(opt => opt.value === sourceConfig.default);
    if (!selectedOption) return;
    const selectedName = selectedOption.name;

    sourceConfig.syncWith.forEach(targetVarName => {
        const targetConfig = variableConfigs[targetVarName];
        if (targetConfig && targetConfig.mode === 'dropdown') {
            const targetOption = targetConfig.options.find(opt => opt.name === selectedName);
            if (targetOption) {
                targetConfig.default = targetOption.value;
                const targetSelect = document.getElementById(sanitizeId(targetVarName) + '_select');
                if (targetSelect) targetSelect.value = targetOption.value;
                const quickMenuSelect = document.getElementById(`quick-menu-select-${sanitizeId(targetVarName)}`);
                if (quickMenuSelect) quickMenuSelect.value = targetOption.value;
            }
        }
    });
    saveState();
}