import { saveState, currentTheme } from '../state.js';
import { triggerResultGeneration, processTemplateAndExtractVariables } from '../core.js';
import { updateExtractBtnVisibility } from '../events.js';
import { debounce } from '../utils.js';

let editorInstance = null;
let resultEditorInstance = null;

export function getEditorInstance() {
    return editorInstance;
}

export function getResultEditorInstance() {
    return resultEditorInstance;
}


export function markCodeBlocks(cm) {
    if (!cm) return;

    cm.operation(() => {
        // Clear previous marks
        // [수정] 모든 마커를 지우도록 단순화하여, 이전 상태가 남는 문제를 방지합니다.
        cm.getAllMarks().forEach(mark => mark.clear());

        const value = cm.getValue();
        const startRegex = /<!-- START: (block_.*?) -->/g;
        let match;

        while ((match = startRegex.exec(value)) !== null) {
            const instanceId = match[1];
            const endComment = `<!-- END: ${instanceId} -->`;
            const endIndex = value.indexOf(endComment, match.index);

            if (endIndex !== -1) {
                const startPos = cm.posFromIndex(match.index);
                const endPos = cm.posFromIndex(endIndex + endComment.length);

                // Mark background for the entire block
                cm.markText(startPos, endPos, {
                    className: 'cm-code-block-background',
                    inclusiveLeft: true,
                    inclusiveRight: true,
                });

                // [추가] 시작 주석을 편집 불가능하게 만듭니다.
                const startCommentEndPos = cm.posFromIndex(match.index + match[0].length);
                cm.markText(startPos, startCommentEndPos, {
                    readOnly: true
                });

                // [추가] 종료 주석을 편집 불가능하게 만듭니다.
                const endCommentStartPos = cm.posFromIndex(endIndex);
                cm.markText(endCommentStartPos, endPos, {
                    readOnly: true
                });
            }
        }
    });
}

export function initializeTemplateEditor() {
    const wrapper = document.getElementById('templateInputWrapper');
    if (!wrapper) return null;

    editorInstance = window.CodeMirror(wrapper, {
        mode: 'xml',
        lineNumbers: true,
        lineWrapping: true,
        autofocus: true,
        theme: currentTheme === 'dark' ? 'material-darker' : 'default',
        value: '<!-- 템플릿을 여기에 입력하세요 -->',
    });

    editorInstance.on('change', debounce(() => {
        markCodeBlocks(editorInstance);
        saveState();
        updateExtractBtnVisibility(); // [추가] 변경 시 버튼 표시 여부 업데이트
        triggerResultGeneration();
    }, 300));

    editorInstance.on('keydown', (cm, e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            processTemplateAndExtractVariables();
            document.getElementById('extractBtn').focus();
        }
    });

    markCodeBlocks(editorInstance); // Initial marking
    return editorInstance;
}

export function initializeResultEditor() {
    const wrapper = document.getElementById('resultOutputWrapper');
    if (!wrapper) return null;

    resultEditorInstance = window.CodeMirror(wrapper, {
        mode: 'xml',
        lineNumbers: true,
        lineWrapping: true,
        readOnly: true,
        theme: currentTheme === 'dark' ? 'material-darker' : 'default',
        value: '<!-- 결과가 여기에 표시됩니다 -->',
    });
    return resultEditorInstance;
}