import { variableConfigs, codeBlocks, syncColorMap, saveState, templateOrder } from '../state.js';
import { sanitizeId, escapeHTML } from '../utils.js';
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

    const regularVars = templateOrder.filter(name => variableConfigs[name] && !blockVarInstances.has(name) && !name.includes('_instance_'));
    const blockVars = templateOrder.filter(name => blockVarInstances.has(name));

    if (regularVars.length === 0 && blockVars.length === 0) {
        contentContainer.innerHTML = `<span class="hint" style="padding: 0 12px;">템플릿에 변수가 없습니다.</span>`;
        return;
    }

    const createMenuItem = (name) => {
        const cfg = variableConfigs[name];
        if (!cfg) return;

        const item = document.createElement('div');
        item.className = 'quick-menu-item';

        const label = document.createElement('label');
        label.textContent = name;
        label.title = name;

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

        const updateScrollShadow = () => {
            const el = labelWrapper;
            const scrollable = el.scrollWidth > el.clientWidth;

            if (scrollable) {
                const atStart = el.scrollLeft < 5;
                const atEnd = el.scrollLeft > el.scrollWidth - el.clientWidth - 5;

                labelContainer.classList.toggle('scroll-start', atStart && !atEnd);
                labelContainer.classList.toggle('scroll-middle', !atStart && !atEnd);
                labelContainer.classList.toggle('scroll-end', atEnd && !atStart);
            }
        };

        setTimeout(updateScrollShadow, 0);
        labelWrapper.addEventListener('scroll', updateScrollShadow);

        const inputWrapper = document.createElement('div');
        inputWrapper.className = 'input-control';

        if (cfg.mode === 'text') {
            const input = document.createElement('input');
            input.type = 'text';
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
            inputWrapper.appendChild(input);
        } else { // dropdown
            const select = document.createElement('select');
            select.id = `quick-menu-select-${sanitizeId(name)}`;
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
                saveState();
                triggerResultGeneration();
            });
            inputWrapper.appendChild(select);
        }

        const shortcutLink = document.createElement('a');
        shortcutLink.href = `#var-field-${sanitizeId(name)}`;
        shortcutLink.title = `${name} 상세 설정으로 이동`;
        shortcutLink.innerHTML = '🔗';

        item.appendChild(labelContainer);
        item.appendChild(inputWrapper);
        item.appendChild(shortcutLink);
        contentContainer.appendChild(item);
    };

    regularVars.forEach(createMenuItem);

    if (regularVars.length > 0 && blockVars.length > 0) {
        const divider = document.createElement('div');
        divider.className = 'quick-menu-divider';
        contentContainer.appendChild(divider);
    }

    blockVars.sort().forEach(createMenuItem);

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
                updateCollapseUI(Object.keys(variableConfigs).length);
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
        const wrapper = e.target.closest('.quick-menu-label-wrapper');
        if (!wrapper || wrapper.scrollWidth <= wrapper.clientWidth) return;
        isDown = true;
        activeWrapper = wrapper;
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
        const x = e.pageX || e.touches[0].pageX;
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