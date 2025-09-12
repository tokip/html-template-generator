import { lockBodyScroll, unlockBodyScroll } from './dom-helpers.js';

export function setupMaximizeMode() {
    let exitBtn = null;

    function exitMaximizeMode() {
        const maximizedElement = document.querySelector('.is-maximized');
        if (maximizedElement) {
            maximizedElement.classList.remove('is-maximized');
            if (exitBtn && exitBtn.parentElement) exitBtn.parentElement.removeChild(exitBtn);
            exitBtn = null;
            unlockBodyScroll([]); // 최대화 해제 시 배경 스크롤 잠금 해제
            document.removeEventListener('keydown', handleEscKey);
        }
    }

    function handleEscKey(e) {
        if (e.key === 'Escape') exitMaximizeMode();
    }

    document.body.addEventListener('click', (e) => {
        const btn = e.target.closest('.fullscreen-btn');
        if (!btn) return;
        const targetElement = document.getElementById(btn.dataset.targetId);
        if (!targetElement) return;

        lockBodyScroll([]); // 최대화 시 배경 스크롤 잠금
        targetElement.classList.add('is-maximized');
        exitBtn = document.createElement('button');
        exitBtn.className = 'modal-close-btn exit-fullscreen-btn exit-fullscreen-styled-btn';
        exitBtn.title = '닫기 (Esc)';
        exitBtn.innerHTML = '&times;';
        exitBtn.onclick = exitMaximizeMode;
        targetElement.appendChild(exitBtn);
        document.addEventListener('keydown', handleEscKey);
    });
}