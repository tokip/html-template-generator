import { variableConfigs, codeBlocks, syncColorMap, saveState, templateOrder } from '../state.js';
import { sanitizeId, escapeHTML, getDisplayVariableName } from '../utils.js';
import { getEditorInstance } from './editor.js';
import { triggerResultGeneration } from '../core.js';
import { lockBodyScroll, unlockBodyScroll } from './dom-helpers.js';
import { syncDropdownSelection } from './variable-fields.js';
import { updateCollapseUI } from './dom-helpers.js';

export function renderQuickMenu() {
    const panel = document.getElementById('quick-menu-panel');
    const contentContainer = document.getElementById('quick-menu-content');
    panel.style.maxHeight = '';
    panel.style.width = 'auto';

    const existingHeader = panel.querySelector('#quick-menu-header');
    if (existingHeader) {
        panel.removeChild(existingHeader);
    }
    contentContainer.innerHTML = '';

    const header = document.createElement('div');
    header.id = 'quick-menu-header';

    const title = document.createElement('span');
    title.className = 'hint';
    title.textContent = `변수 (${Object.keys(variableConfigs).length}개)`;

    const expandBtn = document.createElement('button');
    expandBtn.id = 'quick-menu-expand-btn';
    expandBtn.className = 'secondary';
    expandBtn.type = 'button';
    expandBtn.textContent = panel.classList.contains('is-expanded') ? '간략히 보기' : '크게 보기';
    expandBtn.style.display = 'none';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'quick-menu-close-btn';
    closeBtn.type = 'button';
    closeBtn.className = 'secondary';
    closeBtn.title = '닫기';
    closeBtn.setAttribute('aria-label', '퀵패널 닫기');
    closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M6 18L18 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    if (window.innerWidth <= 1024) {
        panel.classList.add('is-expanded');
        expandBtn.textContent = '간략히 보기';
    } else {
        const quickMenuToggle = document.getElementById('quick-menu-toggle');
        if (quickMenuToggle) {
            quickMenuToggle.style.display = '';
        }
        panel.style.top = '';
        panel.style.bottom = '';
        panel.classList.remove('is-expanded');
        expandBtn.textContent = '크게 보기';
    }

    if (panel.classList.contains('is-open')) {
        const quickMenuToggle = document.getElementById('quick-menu-toggle');
        const toggleRect = quickMenuToggle.getBoundingClientRect();
        const bottomOffset = window.innerHeight - toggleRect.top + 10;
        document.documentElement.style.setProperty('--quick-menu-bottom', `${bottomOffset}px`);
    }

    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const toggleBtn = document.getElementById('quick-menu-toggle');
        if (toggleBtn) toggleBtn.click();
    });

    expandBtn.addEventListener('click', () => {
        panel.classList.toggle('is-expanded');
        expandBtn.textContent = panel.classList.contains('is-expanded') ? '간략히 보기' : '크게 보기';
        adjustQuickMenuPosition();
    });

    const rightControls = document.createElement('div');
    rightControls.style.display = 'flex';
    rightControls.style.gap = '8px';
    rightControls.appendChild(expandBtn);
    rightControls.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(rightControls);
    panel.insertBefore(header, contentContainer);

    const blockVarInstances = new Set();
    const tpl = getEditorInstance()?.getValue() || '';
    const blockInstanceRegex = /<!-- START: (.+?) -->/g;
    let match;
    while ((match = blockInstanceRegex.exec(tpl)) !== null) {
        const instanceId = match[1];
        const varRegex = new RegExp(`{{\\s*(${escapeHTML(instanceId)}_[^\\s{}]+)\\s*}}`, 'g');
        let varMatch;
        while ((varMatch = varRegex.exec(tpl)) !== null) {
            blockVarInstances.add(varMatch[1]);
        }
    }

    // [수정] core.js에서 변수 목록이 정리되었으므로, 분류 로직을 단순화합니다.
    const regularVars = templateOrder.filter(name => variableConfigs[name] && !blockVarInstances.has(name));
    const blockVars = templateOrder.filter(name => variableConfigs[name] && blockVarInstances.has(name));
    // [수정] 중복 색상 계산을 위해 정렬되지 않은 원본 순서를 사용합니다.
    const allVisibleVars = templateOrder.filter(name => variableConfigs[name]);

    // [추가] 중복된 표시 이름을 가진 변수들을 찾아 색상을 할당합니다.
    const duplicateColorMap = {};
    const displayNameCounts = {};
    // allVisibleVars는 정렬되지 않은 상태여야 중복 색상 할당이 일관됩니다.
    allVisibleVars.forEach(name => {
        const displayName = getDisplayVariableName(name, blockVarInstances);
        displayNameCounts[displayName] = (displayNameCounts[displayName] || 0) + 1;
    });

    const duplicateDisplayNames = Object.keys(displayNameCounts).filter(name => displayNameCounts[name] > 1);
    if (duplicateDisplayNames.length > 0) {
        const colors = ['#e11d48', '#db2777', '#9333ea', '#6d28d9', '#4f46e5', '#2563eb', '#0284c7', '#0d9488', '#15803d', '#65a30d', '#ca8a04', '#d97706', '#ea580c'];
        let colorIndex = 0;
        duplicateDisplayNames.forEach(displayName => {
            // [수정] 중복된 이름을 가진 변수 그룹을 templateOrder 순서대로 정렬합니다.
            const duplicates = allVisibleVars
                .filter(fullName => getDisplayVariableName(fullName, blockVarInstances) === displayName)
                .sort((a, b) => templateOrder.indexOf(a) - templateOrder.indexOf(b));
            // [수정] 첫 번째(원본)를 제외한 나머지 중복 변수들에 각각 다른 색상을 할당합니다.
            duplicates.slice(1).forEach(fullName => {
                duplicateColorMap[fullName] = colors[colorIndex % colors.length];
                colorIndex++; // 각 변수마다 다른 색상을 위해 인덱스를 증가시킵니다.
            });
        });
    }

    if (regularVars.length === 0 && blockVars.length === 0) {
        contentContainer.innerHTML = `<span class="hint" style="padding: 0 12px;">템플릿에 변수가 없습니다.</span>`;
        return;
    }

    // [추가] 가상 스크롤을 위한 Intersection Observer 설정
    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const placeholder = entry.target;
                const varName = placeholder.dataset.varName;
                if (varName) {
                    const menuItem = createMenuItem(varName);
                    // [수정] menuItem이 유효한 Node일 때만 교체 작업을 수행합니다.
                    if (menuItem) {
                        placeholder.parentNode.replaceChild(menuItem, placeholder);
                        obs.unobserve(menuItem); // 한 번 렌더링된 아이템은 더 이상 관찰하지 않음
                    }
                }
            }
        });
    }, { root: contentContainer, rootMargin: "200px" }); // 화면에 보이기 200px 전에 미리 로드

    const createPlaceholder = (name) => {
        const placeholder = document.createElement('div');
        placeholder.className = 'quick-menu-item-placeholder';
        placeholder.dataset.varName = name;
        // 높이를 실제 아이템과 유사하게 설정하여 스크롤바가 튀는 현상을 방지
        const cfg = variableConfigs[name];
        placeholder.style.height = (cfg && cfg.mode === 'text') ? '40px' : '40px'; // 모드에 따라 높이 조절 가능
        contentContainer.appendChild(placeholder);
        observer.observe(placeholder);
    };

    const createMenuItem = (name, isBlockVar = false) => {
        const cfg = variableConfigs[name];
        if (!cfg) return;

        const item = document.createElement('div');
        item.className = 'quick-menu-item';

        const label = document.createElement('label');
        label.textContent = getDisplayVariableName(name, blockVarInstances);
        label.title = name;
        // [추가] 접근성을 위해 label과 input/select를 연결합니다.
        const inputId = `quick-menu-input-${sanitizeId(name)}`;
        label.htmlFor = inputId;

        const labelWrapper = document.createElement('div');
        labelWrapper.className = 'quick-menu-label-wrapper';

        const groupDot = document.createElement('span');
        groupDot.className = 'quick-menu-group-dot';
        if (syncColorMap[name]) {
            groupDot.style.setProperty('--sync-color', syncColorMap[name].color);
        }
        labelWrapper.appendChild(groupDot);
        labelWrapper.appendChild(label);

        const labelContainer = document.createElement('div');
        labelContainer.className = 'label-container';
        labelContainer.appendChild(labelWrapper);

        // [추가] 그림자 효과를 위한 래퍼를 추가합니다.
        const shadowWrapper = document.createElement('div');
        shadowWrapper.className = 'scroll-shadow-wrapper';
        shadowWrapper.appendChild(labelContainer);

        // [수정] 중복 이름 하이라이트를 label-container에 적용합니다.
        const duplicateColor = duplicateColorMap[name];
        if (duplicateColor) {
            shadowWrapper.classList.add('duplicate-variable-highlight'); // [수정] 하이라이트를 래퍼에 적용
            // padding-left와 border-left가 겹치지 않도록 조정
            shadowWrapper.style.setProperty('--duplicate-color', duplicateColor);
        }

        const updateScrollShadow = () => {
            const el = labelContainer; // [수정] 스크롤 이벤트를 labelContainer에서 감지
            const scrollable = el.scrollWidth > el.clientWidth;
            if (scrollable) {
                const atStart = el.scrollLeft < 5;
                const atEnd = el.scrollLeft > el.scrollWidth - el.clientWidth - 5;

                el.classList.toggle('scroll-start', atStart && !atEnd);
                el.classList.toggle('scroll-middle', !atStart && !atEnd);
                el.classList.toggle('scroll-end', atEnd && !atStart);
                // [수정] 그림자 클래스를 부모 래퍼에 적용합니다.
                shadowWrapper.className = `scroll-shadow-wrapper ${el.classList.contains('scroll-start') ? 'scroll-start' : ''} ${el.classList.contains('scroll-middle') ? 'scroll-middle' : ''} ${el.classList.contains('scroll-end') ? 'scroll-end' : ''} ${duplicateColor ? 'duplicate-variable-highlight' : ''}`.trim();
            }
        };

        setTimeout(updateScrollShadow, 0);
        labelContainer.addEventListener('scroll', updateScrollShadow); // [수정] 스크롤 이벤트를 labelContainer에 연결

        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'input-control';

        if (cfg.mode === 'text') {
            const input = document.createElement('input');
            input.type = 'text';
            input.id = inputId; // [추가] id 설정
            input.value = cfg.default || '';
            input.addEventListener('input', (e) => {
                cfg.default = e.target.value;
                const detailTextarea = document.getElementById(sanitizeId(name) + '_text');
                if (detailTextarea) {
                    detailTextarea.value = e.target.value;
                    detailTextarea.dispatchEvent(new Event('input', { bubbles: true }));
                }
                saveState();
                triggerResultGeneration();
            });
            // [추가] 포커스 시 텍스트 전체 선택
            input.addEventListener('focus', (e) => {
                e.target.select();
            });
            inputWrapper.appendChild(input);
        } else { // dropdown
            const select = document.createElement('select');
            select.id = inputId; // [수정] id를 label.for와 일치시킵니다.
            cfg.options.forEach(opt => {
                const optionEl = document.createElement('option');
                optionEl.value = opt.value;
                optionEl.textContent = opt.name;
                select.appendChild(optionEl);
            });
            select.value = cfg.default;
            select.addEventListener('change', (e) => {
                cfg.default = e.target.value;
                const detailSelect = document.getElementById(sanitizeId(name) + '_select');
                if (detailSelect) detailSelect.value = e.target.value;

                syncDropdownSelection(name);
                // [수정] 동기화된 다른 변수들의 퀵 메뉴 UI도 업데이트합니다.
                const sourceConfig = variableConfigs[name];
                sourceConfig.syncWith.forEach(targetVarName => {
                    const quickMenuSelect = document.getElementById(`quick-menu-input-${sanitizeId(targetVarName)}`);
                    if (quickMenuSelect) quickMenuSelect.value = variableConfigs[targetVarName].default;
                });
                saveState();
                triggerResultGeneration();
            });
            inputWrapper.appendChild(select);
        }

        const shortcutLink = document.createElement('a');
        shortcutLink.href = `#var-field-${sanitizeId(name)}`;
        shortcutLink.title = `${name} 상세 설정으로 이동`;
        shortcutLink.innerHTML = '🔗';

        item.appendChild(shadowWrapper); // [수정] 그림자 래퍼를 아이템에 추가합니다.
        item.appendChild(inputWrapper);
        item.appendChild(shortcutLink);
        return item; // [수정] 생성된 아이템을 반환하여 가상 스크롤이 동작하도록 합니다.
    };

    // [수정] '변수 설정'과 동일하게, 일반 변수와 코드 블록 변수를 순서대로 렌더링합니다.
    // [수정] 실제 아이템 대신 플레이스홀더를 먼저 렌더링합니다.
    regularVars.forEach(name => createPlaceholder(name));

    if (regularVars.length > 0 && blockVars.length > 0) {
        const divider = document.createElement('div');
        divider.className = 'quick-menu-divider';
        contentContainer.appendChild(divider);
    }

    // [수정] 코드 블록 변수를 그룹별로 렌더링합니다.
    const groupedBlockVars = new Map();
    blockVars.forEach(name => {
        const blockId = name.split('_instance_')[0];
        if (!groupedBlockVars.has(blockId)) {
            groupedBlockVars.set(blockId, []);
        }
        groupedBlockVars.get(blockId).push(name);
    });

    groupedBlockVars.forEach((vars, blockId) => {
        const blockName = codeBlocks[blockId]?.name || blockId;
        const groupHeader = document.createElement('div');
        groupHeader.className = 'quick-menu-group-header';
        groupHeader.textContent = `코드 블록: ${escapeHTML(blockName)}`;
        contentContainer.appendChild(groupHeader);

        // templateOrder 순서대로 정렬하여 렌더링
        vars.sort((a, b) => templateOrder.indexOf(a) - templateOrder.indexOf(b))
            .forEach(name => createPlaceholder(name));
    });

    // 바로가기 링크 이벤트 위임
    contentContainer.addEventListener('click', (e) => {
        const shortcutLink = e.target.closest('a[href^="#var-field-"]');
        if (!shortcutLink) return;

        e.preventDefault();
        e.stopPropagation();
        const targetId = shortcutLink.hash.substring(1);
        const targetElement = document.getElementById(targetId);

        if (targetElement) {
            const wrapper = document.getElementById('variables-content-wrapper');
            const isCollapsed = wrapper.classList.contains('is-collapsed');

            if (isCollapsed && getComputedStyle(targetElement).display === 'none') {
                wrapper.classList.remove('is-collapsed');
                updateCollapseUI(Object.keys(variableConfigs).length); // [수정] 버튼 텍스트 업데이트
            }

            if (targetElement.tagName === 'DETAILS') targetElement.open = true;

            // 스크롤을 먼저 실행하고, 완료된 후 하이라이트 효과를 적용합니다.
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

            // 퀵 메뉴 닫기
            const cachedElementsForClose = {
                quickMenuToggleBtn: document.getElementById('quick-menu-toggle'),
                quickMenuPanel: document.getElementById('quick-menu-panel')
            };
            const fixedButtonsForClose = [document.getElementById('theme-toggle'), document.getElementById('scrollTopBtn')];
            closeQuickMenu(cachedElementsForClose, fixedButtonsForClose);
        }
    });

    requestAnimationFrame(() => {
        if (window.innerWidth > 1024 && (regularVars.length + blockVars.length) > 0) {
            const panelMaxHeight = parseFloat(getComputedStyle(panel).maxHeight);
            const contentHeight = contentContainer.scrollHeight + header.offsetHeight;
            if (contentHeight > panelMaxHeight) {
                expandBtn.style.display = '';
            }
        }
    });
}

export function adjustQuickMenuPosition() {
    const panel = document.getElementById('quick-menu-panel');
    const toggleBtn = document.getElementById('quick-menu-toggle');

    requestAnimationFrame(() => {
        if (window.innerWidth <= 1024) {
            panel.style.top = 'auto';
            panel.style.bottom = '70px';
            const panelHeight = panel.offsetHeight;
            panel.style.maxHeight = `${panelHeight}px`;
        } else if (panel.classList.contains('is-expanded')) {
            panel.style.top = '20px';
            const toggleRect = toggleBtn.getBoundingClientRect();
            const bottomPosition = window.innerHeight - toggleRect.top + 10;
            panel.style.bottom = `${bottomPosition}px`;
        } else {
            const toggleRect = toggleBtn.getBoundingClientRect();
            const bottomPosition = window.innerHeight - toggleRect.top + 10;
            panel.style.top = 'auto';
            panel.style.bottom = `${bottomPosition}px`;
        }
    });
}

/**
 * [추가] 퀵 메뉴 내에서 Tab 키를 눌렀을 때 입력 요소(input, select) 사이에서만 포커스가 이동하도록 처리합니다.
 * @param {KeyboardEvent} e - 키보드 이벤트 객체
 */
function handleTabNavigation(e) {
    if (e.key !== 'Tab') return;

    const panel = document.getElementById('quick-menu-panel');
    const focusableElements = Array.from(panel.querySelectorAll('input, select'));
    if (focusableElements.length === 0) return;

    e.preventDefault();
    const currentIndex = focusableElements.indexOf(document.activeElement);
    let nextIndex;

    if (e.shiftKey) { // Shift + Tab
        nextIndex = (currentIndex - 1 + focusableElements.length) % focusableElements.length;
    } else { // Tab
        nextIndex = (currentIndex + 1) % focusableElements.length;
    }
    focusableElements[nextIndex].focus();
}

let handleOutsideInteraction; // 외부 클릭 핸들러를 저장할 변수

export function toggleQuickMenu(CACHED_ELEMENTS, FIXED_RIGHT_BUTTONS) {
    const isOpen = CACHED_ELEMENTS.quickMenuPanel.classList.toggle('is-open');
    CACHED_ELEMENTS.quickMenuToggleBtn.classList.toggle('is-open', isOpen);

    if (isOpen && window.innerWidth <= 1024) lockBodyScroll(FIXED_RIGHT_BUTTONS);

    if (isOpen) {
        renderQuickMenu();
        adjustQuickMenuPosition();
        document.addEventListener('keydown', handleTabNavigation); // [추가] 탭 네비게이션 핸들러 추가
        // 핸들러 함수 정의
        handleOutsideInteraction = (e) => {
            if (!CACHED_ELEMENTS.quickMenuPanel.contains(e.target) && !CACHED_ELEMENTS.quickMenuToggleBtn.contains(e.target)) {
                closeQuickMenu(CACHED_ELEMENTS, FIXED_RIGHT_BUTTONS);
            }
        };
        setTimeout(() => {
            document.addEventListener('mousedown', handleOutsideInteraction);
            document.addEventListener('touchstart', handleOutsideInteraction);
        }, 0);
    } else {
        closeQuickMenu(CACHED_ELEMENTS, FIXED_RIGHT_BUTTONS);
    }
}

function closeQuickMenu(CACHED_ELEMENTS, FIXED_RIGHT_BUTTONS) {
    CACHED_ELEMENTS.quickMenuToggleBtn.classList.remove('is-open');
    if (window.innerWidth <= 1024) unlockBodyScroll(FIXED_RIGHT_BUTTONS);
    CACHED_ELEMENTS.quickMenuPanel.classList.remove('is-open');
    CACHED_ELEMENTS.quickMenuPanel.style.maxHeight = `${CACHED_ELEMENTS.quickMenuPanel.offsetHeight}px`;
    setTimeout(() => {
        CACHED_ELEMENTS.quickMenuPanel.style.maxHeight = '';
        CACHED_ELEMENTS.quickMenuPanel.style.top = '';
        CACHED_ELEMENTS.quickMenuPanel.style.bottom = '';
    }, 200);
    document.removeEventListener('mousedown', handleOutsideInteraction);
    document.removeEventListener('touchstart', handleOutsideInteraction);
    document.removeEventListener('keydown', handleTabNavigation); // [추가] 탭 네비게이션 핸들러 제거
}

export function setupQuickMenuInteractions(isMobileDevice, CACHED_ELEMENTS, FIXED_RIGHT_BUTTONS) {
    if (!isMobileDevice) {
        CACHED_ELEMENTS.quickMenuPanel.addEventListener('mouseenter', () => {
            if (window.innerWidth > 1024 && CACHED_ELEMENTS.quickMenuPanel.classList.contains('is-open')) {
                lockBodyScroll(FIXED_RIGHT_BUTTONS);
            }
        });
        CACHED_ELEMENTS.quickMenuPanel.addEventListener('mouseleave', () => {
            if (window.innerWidth > 1024) {
                unlockBodyScroll(FIXED_RIGHT_BUTTONS);
            }
        });
    }

    let isDown = false, startX, scrollLeft, activeWrapper = null;
    const startDrag = (e) => {
        // [수정] Grid 레이아웃에서도 이벤트를 감지할 수 있도록 .label-container를 기준으로 찾습니다.
        const wrapper = e.target.closest('.label-container');
        if (!wrapper || wrapper.scrollWidth <= wrapper.clientWidth) return;
        isDown = true;
        activeWrapper = wrapper;
        // activeWrapper는 이제 .label-container가 됩니다.
        startX = e.pageX || e.touches[0].pageX;
        scrollLeft = activeWrapper.scrollLeft;
        window.addEventListener('mousemove', doDrag);
        window.addEventListener('mouseup', endDrag);
        window.addEventListener('touchmove', doDrag, { passive: false });
        window.addEventListener('touchend', endDrag);
    };
    const doDrag = (e) => {
        if (!isDown || !activeWrapper) return;
        e.preventDefault();
        // [수정] 마우스 이벤트와 터치 이벤트를 구분하여 처리합니다.
        const x = e.type === 'touchmove' ? e.touches[0].pageX : e.pageX;
        const walk = (x - startX) * 1.5;
        activeWrapper.scrollLeft = scrollLeft - walk;
    };
    const endDrag = () => {
        if (!isDown) return;
        isDown = false;
        activeWrapper = null;
        window.removeEventListener('mousemove', doDrag);
        window.removeEventListener('mouseup', endDrag);
        window.removeEventListener('touchmove', doDrag);
        window.removeEventListener('touchend', endDrag);
    };
    CACHED_ELEMENTS.quickMenuPanel.addEventListener('mousedown', startDrag);
    CACHED_ELEMENTS.quickMenuPanel.addEventListener('touchstart', startDrag, { passive: true });
}