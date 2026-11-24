// ==UserScript==
// @name         翻译机V2
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  该脚本用于翻译各类常用社交网站为中文，不会经过中间服务器。
// @author       HolynnChen
// @match        *://*.twitter.com/*
// @match        *://*.x.com/*
// @match        *://*.youtube.com/*
// @match        *://*.facebook.com/*
// @match        *://*.reddit.com/*
// @match        *://*.5ch.net/*
// @match        *://*.discord.com/*
// @match        *://*.telegram.org/*
// @match        *://*.quora.com/*
// @match        *://*.tiktok.com/*
// @match        *://*.instagram.com/*
// @match        *://*.threads.net/*
// @match        *://*.github.com/*
// @match        *://*.bsky.app/*
// @connect      fanyi.baidu.com
// @connect      translate.google.com
// @connect      ifanyi.iciba.com
// @connect      www.bing.com
// @connect      fanyi.youdao.com
// @connect      dict.youdao.com
// @connect      m.youdao.com
// @connect      api.interpreter.caiyunai.com
// @connect      papago.naver.com
// @connect      fanyi.qq.com
// @connect      translate.alibaba.com
// @connect      www2.deepl.com
// @connect      transmart.qq.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js
// @require      https://cdn.jsdelivr.net/npm/js-base64@3.7.4/base64.min.js
// @require      https://cdn.jsdelivr.net/npm/lz-string@1.5.0/libs/lz-string.min.js
// @require      https://cdn.jsdelivr.net/gh/Tampermonkey/utils@3b32b826e84ccc99a0a3e3d8d6e5ce0fa9834f23/requires/gh_2215_make_GM_xhr_more_parallel_again.js
// @run-at       document-body
// @downloadURL https://update.greasyfork.org/scripts/378277/%E7%BF%BB%E8%AF%91%E6%9C%BA.user.js
// @updateURL https://update.greasyfork.org/scripts/378277/%E7%BF%BB%E8%AF%91%E6%9C%BA.meta.js
// ==/UserScript==


GM_registerMenuCommand('重置控制面板位置(刷新应用)', () => {
    GM_setValue('position_top', '309px');
    GM_setValue('position_right', '9px');
})

GM_registerMenuCommand('全局隐藏/展示悬浮球(刷新应用)', () => {
    GM_setValue('show_translate_ball', !GM_getValue('show_translate_ball',true));
})


const transdict = {
    '谷歌翻译': translate_gg,
    '谷歌翻译mobile': translate_ggm,
    '腾讯翻译': translate_tencent,
    '腾讯AI翻译': translate_tencentai,
    //'有道翻译':translate_youdao,
    '有道翻译mobile': translate_youdao_mobile,
    '百度翻译': translate_baidu,
    '彩云小译': translate_caiyun,
    '必应翻译': translate_biying,
    'Papago翻译': translate_papago,
    '阿里翻译': translate_alibaba,
    '爱词霸翻译': translate_icib,
    'Deepl翻译': translate_deepl,
    '关闭翻译': () => { }
};
const startup = {
    //'有道翻译':translate_youdao_startup,
    '腾讯翻译': translate_tencent_startup,
    '彩云小译': translate_caiyun_startup,
    'Papago翻译': translate_papago_startup
};
const baseoptions = {
    'enable_pass_lang': {
        declare: '不翻译中文(简体)',
        default_value: true,
        change_func: self => {
            if (self.checked) sessionStorage.clear()
        }
    },
    'enable_pass_lang_cht': {
        declare: '不翻译中文(繁体)',
        default_value: true,
        change_func: self => {
            if (self.checked) sessionStorage.clear()
        }
    },
    'remove_url': {
        declare: '自动过滤url',
        default_value: true,
    },
    'show_info': {
        declare: '显示翻译源',
        default_value: true,
        option_enable: true
    },
    'fullscrenn_hidden': {
        declare: '全屏时不显示',
        default_value: true,
    },
    'replace_translate': {
        declare: '替换式翻译',
        default_value: false,
        option_enable: true
    },
    'compress_storage':{
        declare: '压缩缓存',
        default_value: false,
    }
};

const [enable_pass_lang, enable_pass_lang_cht, remove_url, show_info, fullscrenn_hidden, replace_translate, compress_storage] = Object.keys(baseoptions).map(key => GM_getValue(key, baseoptions[key].default_value));

const globalProcessingSave = [];

const sessionStorage = compress_storage?CompressMergeSession(window.sessionStorage):window.sessionStorage;

const p = window.trustedTypes !== undefined ? window.trustedTypes.createPolicy('translator', { createHTML: (string, sink) => string }) : { createHTML: (string, sink) => string };

let isReplaceMode = GM_getValue('replace_translate', false);
let isPausedMode = GM_getValue('translator_paused', false);

if (isReplaceMode) {
    document.documentElement.classList.add('translator-replace-mode');
}
if (isPausedMode) {
    document.documentElement.classList.add('translator-paused-mode');
}

// 动态注入即时切换样式（暂停/关闭模式无感还原纯原文；替换模式仅显示译文）
const instantStyle = document.createElement('style');
instantStyle.textContent = `
    /* 暂停/关闭翻译模式：无感还原为纯原始语言，瞬间隐藏所有译文 */
    .translator-paused-mode .translator-original {
        display: contents !important;
    }
    .translator-paused-mode .translator-result {
        display: none !important;
    }
    .translator-paused-mode .translator-break {
        display: none !important;
    }

    /* 替换模式（仅在未暂停时生效）：隐藏原文，仅保留译文 */
    html:not(.translator-paused-mode).translator-replace-mode .translator-original,
    :not(.translator-paused-mode).translator-replace-mode .translator-original {
        display: none !important;
    }
    html:not(.translator-paused-mode).translator-replace-mode .translator-break,
    :not(.translator-paused-mode).translator-replace-mode .translator-break {
        display: none !important;
    }

    /* GitHub 原生工具栏注入按钮样式 */
    .translator-gh-btn {
        display: inline-flex !important;
        align-items: center !important;
        gap: 4px !important;
        height: 28px !important;
        padding: 3px 8px !important;
        font-size: 12px !important;
        font-weight: 500 !important;
        line-height: 20px !important;
        color: #24292f !important;
        background-color: #f6f8fa !important;
        border: 1px solid rgba(31, 35, 40, 0.15) !important;
        border-radius: 6px !important;
        cursor: pointer !important;
        user-select: none !important;
        text-decoration: none !important;
        vertical-align: middle !important;
        transition: 80ms cubic-bezier(0.33, 1, 0.68, 1) !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif !important;
        margin-right: 6px !important;
    }
    .translator-gh-btn:hover {
        background-color: #f3f4f6 !important;
        border-color: rgba(31, 35, 40, 0.25) !important;
        color: #5842f4 !important;
    }
    .translator-gh-btn:active {
        background-color: #ebecf0 !important;
    }
    .translator-gh-btn svg {
        width: 13px !important;
        height: 13px !important;
        fill: currentColor !important;
    }
    #gh-translator-btn-group {
        display: inline-flex !important;
        align-items: center !important;
        margin-right: 6px !important;
        vertical-align: middle !important;
    }
`;
(document.head || document.documentElement).appendChild(instantStyle);

function initPanel() {
    let choice = GM_getValue('translate_choice', '谷歌翻译');
    let backupChoice = GM_getValue('translate_backup_choice', '必应翻译');

    // 1. 创建全屏透明遮罩（用于捕获点击空白处关闭面板，无毛玻璃、无暗黑遮挡）
    let mask = document.createElement('div');
    mask.className = 'translator-mask';
    mask.style.visibility = 'visible';

    let dialog = document.createElement('div');
    dialog.className = 'translator-dialog';
    dialog.style.visibility = 'visible';

    // 点击遮罩空白区域（dialog 外部）关闭面板
    mask.addEventListener('click', event => {
        if (event.target === mask) mask.style.display = 'none';
    });

    // 2. 弹窗顶部 Header（极简扁平风格，Sticky 顶部悬停）
    let header = document.createElement('div');
    header.className = 'translator-header';

    let titleBox = document.createElement('div');
    titleBox.className = 'translator-title';
    titleBox.innerHTML = p.createHTML(`
        <svg style="width:16px;height:16px;flex-shrink:0;" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M440.32 633.6v256q0 13.824 9.728 23.552t23.552 9.728h416q13.824 0 23.552-9.728t9.728-23.552V473.6q0-13.824-9.728-23.552t-23.552-9.728h-256V378.88h256q39.2704 0 66.9696 27.648 27.7504 27.6992 27.7504 67.072v416q0 39.2704-27.648 66.9696-27.6992 27.7504-67.072 27.7504H473.6q-39.2704 0-66.9696-27.648-27.7504-27.6992-27.7504-67.072v-256h61.44z" fill="#5842f4"></path><path d="M51.2 51.2m102.4 0l358.4 0q102.4 0 102.4 102.4l0 358.4q0 102.4-102.4 102.4l-358.4 0q-102.4 0-102.4-102.4l0-358.4q0-102.4 102.4-102.4Z" fill="#5842f4"></path><path d="M192 404.2752h46.6944v-24.7808H306.176v118.272h49.5104v-118.272h68.7616v20.6336h50.8416V243.3536H355.6352v-34.3552c0-10.0864 1.3824-18.7904 4.096-26.112a10.5472 10.5472 0 0 0 1.3824-4.1472c0-0.9216-3.1744-1.792-9.5744-2.7648H304.64v67.3792H192v160.9216z m46.6944-122.368H306.176v60.416H238.7456v-60.416z m185.7024 60.416H355.6352v-60.416h68.7616v60.4672z" fill="#ffffff"></path><path d="M628.224 817.5616l19.2512-53.6064h100.352l19.3024 53.6064h54.9888L732.672 563.2H668.16l-92.1088 254.4128h52.224z m33.024-96.256l37.12-108.5952h1.3824l34.3552 108.5952h-72.8576zM896 294.4h-64a128 128 0 0 0-128-128V102.4a192 192 0 0 1 192 192z m-768 384h64a128 128 0 0 0 128 128V870.4a192 192 0 0 1-192-192z" fill="#5842f4"></path></svg>
        <span id="panel_title_text">翻译机 控制面板</span>
    `);

    let closeBtn = document.createElement('div');
    closeBtn.className = 'translator-close';
    closeBtn.innerHTML = p.createHTML('✕');
    closeBtn.title = '关闭';
    closeBtn.onclick = () => { mask.style.display = 'none'; };

    header.appendChild(titleBox);
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    // 3. 弹窗主体 Body
    let body = document.createElement('div');
    body.className = 'translator-body';

    // 模块 A：主备双引擎与无感容灾
    let engineSection = document.createElement('div');
    engineSection.className = 'translator-section';
    engineSection.innerHTML = p.createHTML('<div class="translator-section-title">翻译引擎 (主备容灾)</div>');

    // 1. 首选引擎
    let primaryLabel = document.createElement('div');
    primaryLabel.className = 'translator-sub-label';
    primaryLabel.innerText = '首选主引擎：';
    engineSection.appendChild(primaryLabel);

    let selectWrapper = document.createElement('div');
    selectWrapper.className = 'engine-select-wrapper';
    let select = document.createElement("select");
    select.className = 'engine-select';
    select.onchange = () => {
        GM_setValue('translate_choice', select.value);
        choice = select.value;
        const titleSpan = titleBox.querySelector('#panel_title_text');
        if (titleSpan) titleSpan.innerText = "控制面板 (已切换，刷新应用)";
    };
    for (let i in transdict) {
        select.innerHTML = p.createHTML(select.innerHTML + '<option value="' + i + '">' + i + '</option>');
    }
    selectWrapper.appendChild(select);
    engineSection.appendChild(selectWrapper);

    // 2. 备用引擎
    let backupLabel = document.createElement('div');
    backupLabel.className = 'translator-sub-label';
    backupLabel.style.marginTop = '6px';
    backupLabel.innerText = '备用容灾引擎：';
    engineSection.appendChild(backupLabel);

    let backupWrapper = document.createElement('div');
    backupWrapper.className = 'engine-select-wrapper';
    let backupSelect = document.createElement("select");
    backupSelect.className = 'engine-select';
    backupSelect.onchange = () => {
        GM_setValue('translate_backup_choice', backupSelect.value);
        backupChoice = backupSelect.value;
        const titleSpan = titleBox.querySelector('#panel_title_text');
        if (titleSpan) titleSpan.innerText = "控制面板 (已更新备用引擎)";
    };
    for (let i in transdict) {
        backupSelect.innerHTML = p.createHTML(backupSelect.innerHTML + '<option value="' + i + '">' + i + '</option>');
    }
    backupWrapper.appendChild(backupSelect);
    engineSection.appendChild(backupWrapper);

    // 3. 主备无感容灾开关
    let failoverRow = document.createElement('div');
    failoverRow.className = 'option-item';
    failoverRow.style.marginTop = '6px';

    let failoverLabel = document.createElement('span');
    failoverLabel.innerText = '主备自动容灾切换 (失败自动降级)';

    let failoverSwitch = document.createElement('label');
    failoverSwitch.className = 'translator-switch';
    let failoverInput = document.createElement('input');
    failoverInput.type = 'checkbox';
    failoverInput.checked = GM_getValue('enable_failover', true);
    failoverInput.onchange = () => {
        GM_setValue('enable_failover', failoverInput.checked);
        const titleSpan = titleBox.querySelector('#panel_title_text');
        if (titleSpan) titleSpan.innerText = "控制面板 (已更新)";
    };
    let failoverSlider = document.createElement('span');
    failoverSlider.className = 'translator-slider';
    failoverSwitch.appendChild(failoverInput);
    failoverSwitch.appendChild(failoverSlider);
    failoverRow.appendChild(failoverLabel);
    failoverRow.appendChild(failoverSwitch);
    engineSection.appendChild(failoverRow);

    body.appendChild(engineSection);

    // 模块 B：通用基础配置（极简简约 Switch 切换，排版更紧凑）
    let baseSection = document.createElement('div');
    baseSection.className = 'translator-section';
    baseSection.innerHTML = p.createHTML('<div class="translator-section-title">基础配置</div>');

    for (let i in baseoptions) {
        let optItem = document.createElement('div');
        optItem.className = 'option-item';

        let labelSpan = document.createElement('span');
        labelSpan.innerText = baseoptions[i].declare;

        let switchLabel = document.createElement('label');
        switchLabel.className = 'translator-switch';

        let input = document.createElement('input');
        input.type = 'checkbox';
        input.name = i;
        input.checked = GM_getValue(i, baseoptions[i].default_value);

        input.onchange = () => {
            if (i === 'replace_translate') {
                isReplaceMode = input.checked;
                GM_setValue('replace_translate', isReplaceMode);
                document.documentElement.classList.toggle('translator-replace-mode', isReplaceMode);
                if (typeof updateBottomBtn === 'function') updateBottomBtn();
            } else {
                GM_setValue(i, input.checked);
                if (baseoptions[i].change_func) baseoptions[i].change_func(input);
                const titleSpan = titleBox.querySelector('#panel_title_text');
                if (titleSpan) titleSpan.innerText = "控制面板 (已更新)";
            }
        };

        let sliderSpan = document.createElement('span');
        sliderSpan.className = 'translator-slider';

        switchLabel.appendChild(input);
        switchLabel.appendChild(sliderSpan);

        optItem.appendChild(labelSpan);
        optItem.appendChild(switchLabel);
        baseSection.appendChild(optItem);
    }
    body.appendChild(baseSection);

    // 模块 C：全局快捷键支持（默认关闭，自定义设置）
    let shortcutSection = document.createElement('div');
    shortcutSection.className = 'translator-section';
    shortcutSection.innerHTML = p.createHTML('<div class="translator-section-title">全局快捷键设置 (默认关闭)</div>');

    let shortcutToggleRow = document.createElement('div');
    shortcutToggleRow.className = 'option-item';

    let shortcutMasterLabel = document.createElement('span');
    shortcutMasterLabel.innerText = '启用全局快捷键';

    let shortcutMasterSwitch = document.createElement('label');
    shortcutMasterSwitch.className = 'translator-switch';

    let shortcutMasterInput = document.createElement('input');
    shortcutMasterInput.type = 'checkbox';
    shortcutMasterInput.checked = GM_getValue('enable_shortcuts', false);

    let shortcutBox = document.createElement('div');
    shortcutBox.style.display = shortcutMasterInput.checked ? 'flex' : 'none';
    shortcutBox.style.flexDirection = 'column';
    shortcutBox.style.gap = '4px';
    shortcutBox.style.marginTop = '6px';
    shortcutBox.style.borderTop = '1px dashed #e1e4e8';
    shortcutBox.style.paddingTop = '6px';

    shortcutMasterInput.onchange = () => {
        GM_setValue('enable_shortcuts', shortcutMasterInput.checked);
        shortcutBox.style.display = shortcutMasterInput.checked ? 'flex' : 'none';
        const titleSpan = titleBox.querySelector('#panel_title_text');
        if (titleSpan) titleSpan.innerText = "控制面板 (已更新快捷键开关)";
    };

    let shortcutSlider = document.createElement('span');
    shortcutSlider.className = 'translator-slider';
    shortcutMasterSwitch.appendChild(shortcutMasterInput);
    shortcutMasterSwitch.appendChild(shortcutSlider);
    shortcutToggleRow.appendChild(shortcutMasterLabel);
    shortcutToggleRow.appendChild(shortcutMasterSwitch);
    shortcutSection.appendChild(shortcutToggleRow);

    // 创建可自定义录制快捷键项
    const createShortcutRow = (label, keyName, defaultVal) => {
        let row = document.createElement('div');
        row.className = 'shortcut-row';

        let labelSpan = document.createElement('span');
        labelSpan.innerText = label;

        let keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.readOnly = true;
        keyInput.className = 'shortcut-input';
        keyInput.value = GM_getValue(keyName, defaultVal);
        keyInput.title = '点击后在键盘上直接按下组合键即可自定义修改';

        keyInput.onfocus = () => {
            keyInput.value = '按下组合键...';
            keyInput.classList.add('recording');
        };
        keyInput.onblur = () => {
            keyInput.classList.remove('recording');
            keyInput.value = GM_getValue(keyName, defaultVal);
        };
        keyInput.onkeydown = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const parts = [];
            if (ev.ctrlKey) parts.push('Ctrl');
            if (ev.altKey) parts.push('Alt');
            if (ev.shiftKey) parts.push('Shift');
            if (ev.metaKey) parts.push('Meta');
            const k = ev.key.toUpperCase();
            if (!['CONTROL', 'ALT', 'SHIFT', 'META'].includes(k)) {
                parts.push(k);
            }
            if (parts.length > 0 && !['CONTROL', 'ALT', 'SHIFT', 'META'].includes(k)) {
                const combo = parts.join('+');
                keyInput.value = combo;
                GM_setValue(keyName, combo);
                keyInput.blur();
                const titleSpan = titleBox.querySelector('#panel_title_text');
                if (titleSpan) titleSpan.innerText = `快捷键已设置为 [${combo}]`;
            }
        };

        row.appendChild(labelSpan);
        row.appendChild(keyInput);
        return row;
    };

    shortcutBox.appendChild(createShortcutRow('开关翻译 (中/原)', 'shortcut_toggle_pause', 'Alt+T'));
    shortcutBox.appendChild(createShortcutRow('切换模式 (追/替)', 'shortcut_toggle_mode', 'Alt+R'));
    shortcutBox.appendChild(createShortcutRow('呼出/关闭面板', 'shortcut_toggle_panel', 'Alt+P'));
    shortcutSection.appendChild(shortcutBox);
    body.appendChild(shortcutSection);

    // 模块 D：当前启用规则的个性化配置
    let current_details = document.createElement('details');
    current_details.className = 'translator-details';
    current_details.open = true;
    body.appendChild(current_details);

    const renderCurrentRule = () => {
        current_details.style.display = "none";
        current_details.innerHTML = p.createHTML('');
        const currentRule = GetActiveRule();
        if (currentRule) {
            current_details.style.display = "block";
            current_details.innerHTML = p.createHTML(`<summary><span>当前站点规则 · ${currentRule.name}</span><span style="font-size:10px;color:#57606a">▼</span></summary>`);
            
            let ruleBox = document.createElement('div');
            ruleBox.className = 'current-rule-box';

            for (const option of currentRule.options) {
                let group = document.createElement('div');
                group.className = 'current-option-group';

                let nameRow = document.createElement('div');
                nameRow.className = 'current-option-name';
                
                let optTitle = document.createElement('span');
                optTitle.innerText = option.name;

                let switchLabel = document.createElement('label');
                switchLabel.className = 'translator-switch';

                let enableInput = document.createElement('input');
                enableInput.type = 'checkbox';
                const enableKey = `enable_option:${currentRule.name}-${option.name}`;
                enableInput.checked = GM_getValue(enableKey, true);
                enableInput.onchange = () => {
                    GM_setValue(enableKey, enableInput.checked);
                    const titleSpan = titleBox.querySelector('#panel_title_text');
                    if (titleSpan) titleSpan.innerText = "控制面板 (已更新)";
                };

                let slider = document.createElement('span');
                slider.className = 'translator-slider';
                switchLabel.appendChild(enableInput);
                switchLabel.appendChild(slider);

                nameRow.appendChild(optTitle);
                nameRow.appendChild(switchLabel);
                group.appendChild(nameRow);

                for (const key in baseoptions) {
                    if (!baseoptions[key].option_enable) continue;
                    let radioTitle = document.createElement('div');
                    radioTitle.style.cssText = 'font-size:11px;color:#57606a;margin-top:3px';
                    radioTitle.innerText = baseoptions[key].declare + '：';
                    group.appendChild(radioTitle);

                    let radioGroup = document.createElement('div');
                    radioGroup.className = 'radio-group';
                    const baseValueList = [["", "默认"], ["true", "启用"], ["false", "禁用"]];

                    for (const value of baseValueList) {
                        let rLabel = document.createElement('label');
                        rLabel.className = 'radio-label';

                        let radio = document.createElement('input');
                        radio.type = 'radio';
                        radio.name = `${key}:${currentRule.name}-${option.name}`;
                        radio.value = value[0];
                        const optKey = `option_setting:${radio.name}`;
                        if (GM_getValue(optKey, '').toString() === value[0]) {
                            radio.checked = true;
                        }

                        radio.onchange = () => {
                            switch (radio.value) {
                                case 'true': GM_setValue(optKey, true); break;
                                case 'false': GM_setValue(optKey, false); break;
                                case '': GM_deleteValue(optKey); break;
                            }
                            const titleSpan = titleBox.querySelector('#panel_title_text');
                            if (titleSpan) titleSpan.innerText = "控制面板 (已更新)";
                        };

                        rLabel.appendChild(radio);
                        rLabel.appendChild(document.createTextNode(value[1]));
                        radioGroup.appendChild(rLabel);
                    }
                    group.appendChild(radioGroup);
                }
                ruleBox.appendChild(group);
            }
            current_details.appendChild(ruleBox);
        }
    };

    // 模块 E：支持的网站规则列表（升级为 3 列网格紧凑标签）
    let enable_details = document.createElement('details');
    enable_details.className = 'translator-details';
    enable_details.innerHTML = p.createHTML(`<summary><span>启用规则 (${rules.length})</span><span style="font-size:10px;color:#57606a">▼</span></summary>`);

    let rulesGrid = document.createElement('div');
    rulesGrid.className = 'rules-grid';
    for (let i of rules) {
        let label = document.createElement('label');
        label.className = 'rule-tag';
        label.title = i.name;

        let temp = document.createElement('input');
        temp.type = 'checkbox';
        temp.name = i.name;
        temp.checked = GM_getValue("enable_rule:" + temp.name, true);
        temp.onclick = _ => {
            GM_setValue('enable_rule:' + temp.name, temp.checked);
            const titleSpan = titleBox.querySelector('#panel_title_text');
            if (titleSpan) titleSpan.innerText = "控制面板 (请刷新以应用)";
        };

        label.appendChild(temp);
        let nameSpan = document.createElement('span');
        nameSpan.className = 'rule-name';
        nameSpan.innerText = i.name;
        label.appendChild(nameSpan);
        rulesGrid.appendChild(label);
    }
    enable_details.appendChild(rulesGrid);
    body.appendChild(enable_details);

    dialog.appendChild(body);
    mask.appendChild(dialog);

    // 4. 创建 Shadow DOM 样式隔离与浮标
    let shadowRoot = document.createElement('div');
    shadowRoot.style = "position: absolute; visibility: hidden;";
    window.top.document.body.appendChild(shadowRoot);
    let shadow = shadowRoot.attachShadow({ mode: "closed" });

    // 注入极简扁平 CSS（3列网格、完美原生滚轮支持、快捷键与导出样式）
    let panelStyle = document.createElement('style');
    panelStyle.textContent = `
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .translator-mask {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: transparent;
            z-index: 99999; display: none; visibility: visible !important;
            align-items: center; justify-content: center;
        }
        .translator-dialog {
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            width: 380px; max-width: 95vw; max-height: 82vh;
            background: #ffffff; border: 1px solid #d0d7de; border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12); display: flex; flex-direction: column;
            overflow-y: auto; overflow-x: hidden;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
            color: #24292f; visibility: visible !important; z-index: 100000;
        }
        .translator-dialog::-webkit-scrollbar { width: 5px; }
        .translator-dialog::-webkit-scrollbar-thumb { background: #d0d7de; border-radius: 3px; }
        .translator-dialog::-webkit-scrollbar-track { background: transparent; }

        .translator-header {
            position: sticky; top: 0; z-index: 10;
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 14px; border-bottom: 1px solid #d0d7de; background: #f6f8fa;
        }
        .translator-title {
            font-size: 13px; font-weight: 600; color: #24292f;
            display: flex; align-items: center; gap: 7px;
        }
        .translator-close {
            width: 22px; height: 22px; border-radius: 4px;
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; color: #57606a; font-size: 13px; user-select: none;
        }
        .translator-close:hover { background: #eaecef; color: #24292f; }
        .translator-body {
            padding: 10px 14px; display: flex; flex-direction: column; gap: 10px;
        }
        .translator-section {
            background: #fafbfc; border-radius: 6px; padding: 8px 10px; border: 1px solid #e1e4e8;
        }
        .translator-section-title {
            font-size: 11px; font-weight: 600; color: #57606a; margin-bottom: 5px;
        }
        .translator-sub-label {
            font-size: 11px; color: #57606a; margin-bottom: 3px;
        }
        .engine-select-wrapper { width: 100%; margin-bottom: 4px; }
        .engine-select {
            width: 100%; height: 30px; padding: 0 8px; border-radius: 6px;
            border: 1px solid #d0d7de; background: #ffffff; font-size: 12.5px;
            color: #24292f; outline: none; cursor: pointer;
        }
        .engine-select:focus { border-color: #5842f4; }
        .option-item {
            display: flex; align-items: center; justify-content: space-between;
            padding: 4px 0; font-size: 12px; color: #24292f;
        }
        .option-item:not(:last-child) { border-bottom: 1px solid #f0f2f5; }
        .translator-switch { position: relative; display: inline-block; width: 30px; height: 16px; flex-shrink: 0; }
        .translator-switch input { opacity: 0; width: 0; height: 0; }
        .translator-slider {
            position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
            background-color: #d0d7de; transition: .15s; border-radius: 8px;
        }
        .translator-slider:before {
            position: absolute; content: ""; height: 12px; width: 12px; left: 2px; bottom: 2px;
            background-color: white; transition: .15s; border-radius: 50%;
        }
        input:checked + .translator-slider { background-color: #5842f4; }
        input:checked + .translator-slider:before { transform: translateX(14px); }

        .shortcut-row {
            display: flex; align-items: center; justify-content: space-between;
            padding: 3px 0; font-size: 11.5px; color: #24292f;
        }
        .shortcut-input {
            width: 90px; height: 22px; text-align: center; border: 1px solid #d0d7de;
            border-radius: 4px; font-size: 11px; background: #ffffff; cursor: pointer;
            color: #24292f; font-family: monospace; outline: none; transition: border 0.15s;
        }
        .shortcut-input.recording {
            border-color: #5842f4; background: #f0edff; color: #5842f4; font-weight: bold;
        }

        .export-btn-group {
            display: flex; gap: 8px; margin-top: 4px;
        }
        .export-btn {
            flex: 1; height: 28px; border: 1px solid #d0d7de; border-radius: 6px;
            background: #ffffff; font-size: 11.5px; font-weight: 500; color: #24292f;
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            gap: 4px; transition: all 0.15s; outline: none;
        }
        .export-btn:hover {
            background: #f3f4f6; border-color: #5842f4; color: #5842f4;
        }

        details.translator-details {
            background: #fafbfc; border: 1px solid #e1e4e8; border-radius: 6px; overflow: hidden;
        }
        details.translator-details summary {
            padding: 7px 10px; font-size: 12px; font-weight: 600; color: #24292f;
            cursor: pointer; user-select: none; outline: none;
            list-style: none; display: flex; align-items: center; justify-content: space-between;
            background: #f6f8fa;
        }
        details.translator-details summary::-webkit-details-marker { display: none; }
        details.translator-details summary:hover { background: #eaecef; }
        
        .rules-grid {
            display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 4px; padding: 8px 10px;
            background: #ffffff; border-top: 1px solid #e1e4e8;
        }
        .rule-tag {
            display: flex; align-items: center; gap: 4px; font-size: 11px;
            color: #24292f; cursor: pointer; min-width: 0;
        }
        .rule-tag input { flex-shrink: 0; margin: 0; cursor: pointer; }
        .rule-name {
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        .current-rule-box {
            padding: 8px 10px; background: #ffffff; border-top: 1px solid #e1e4e8;
            display: flex; flex-direction: column; gap: 8px;
        }
        .current-option-group {
            background: #fafbfc; border-radius: 4px; padding: 6px 8px; border: 1px solid #eaecef;
        }
        .current-option-name {
            font-size: 11.5px; font-weight: 600; color: #24292f;
            display: flex; justify-content: space-between; align-items: center;
        }
        .radio-group { display: flex; gap: 10px; font-size: 11.5px; color: #57606a; margin-top: 3px; }
        .radio-label { display: flex; align-items: center; gap: 3px; cursor: pointer; }
    `;
    shadow.appendChild(panelStyle);
    shadow.appendChild(mask);

    // 5. 浮标外层容器（主按钮 + 左侧中/原开关 + 下方替/追开关）
    let ballWrapper = document.createElement('div');
    ballWrapper.style = `z-index:9999;position:fixed;right:${GM_getValue('position_right', '9px')};top:${GM_getValue('position_top', '309px')};user-select:none;visibility:visible;width:85px;height:85px;`;

    let open = document.createElement('div');
    open.style = `position:absolute;right:8px;top:8px;height:35px;width:35px;background-color:#fff;border:1px solid #d0d7de;border-radius:17.5px;text-align-last:center;color:#000000;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px;box-shadow:none;`;
    const translateIconSvg = '<svg class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" style="width:22px;height:22px;display:block;"><path d="M440.32 633.6v256q0 13.824 9.728 23.552t23.552 9.728h416q13.824 0 23.552-9.728t9.728-23.552V473.6q0-13.824-9.728-23.552t-23.552-9.728h-256V378.88h256q39.2704 0 66.9696 27.648 27.7504 27.6992 27.7504 67.072v416q0 39.2704-27.648 66.9696-27.6992 27.7504-67.072 27.7504H473.6q-39.2704 0-66.9696-27.648-27.7504-27.6992-27.7504-67.072v-256h61.44z" fill="#5842f4"></path><path d="M51.2 51.2m102.4 0l358.4 0q102.4 0 102.4 102.4l0 358.4q0 102.4-102.4 102.4l-358.4 0q-102.4 0-102.4-102.4l0-358.4q0-102.4 102.4-102.4Z" fill="#5842f4"></path><path d="M192 404.2752h46.6944v-24.7808H306.176v118.272h49.5104v-118.272h68.7616v20.6336h50.8416V243.3536H355.6352v-34.3552c0-10.0864 1.3824-18.7904 4.096-26.112a10.5472 10.5472 0 0 0 1.3824-4.1472c0-0.9216-3.1744-1.792-9.5744-2.7648H304.64v67.3792H192v160.9216z m46.6944-122.368H306.176v60.416H238.7456v-60.416z m185.7024 60.416H355.6352v-60.416h68.7616v60.4672z" fill="#ffffff"></path><path d="M628.224 817.5616l19.2512-53.6064h100.352l19.3024 53.6064h54.9888L732.672 563.2H668.16l-92.1088 254.4128h52.224z m33.024-96.256l37.12-108.5952h1.3824l34.3552 108.5952h-72.8576zM896 294.4h-64a128 128 0 0 0-128-128V102.4a192 192 0 0 1 192 192z m-768 384h64a128 128 0 0 0 128 128V870.4a192 192 0 0 1-192-192z" fill="#5842f4"></path></svg>';
    open.innerHTML = p.createHTML(translateIconSvg);
    open.title = "点击打开翻译机控制面板";

    // 1. 左侧快捷开关按钮（控制开启/关闭翻译，显示“中”或“原”）
    let leftBtn = document.createElement('div');
    leftBtn.style = `position:absolute;right:48px;top:11.5px;height:28px;width:28px;background-color:#fff;border:1px solid #d0d7de;border-radius:14px;display:none;align-items:center;justify-content:center;cursor:pointer;font-size:13px;font-weight:bold;box-shadow:none;transition:all 0.15s ease;`;

    const updateLeftBtn = () => {
        leftBtn.innerHTML = p.createHTML(isPausedMode ? "中" : "原");
        leftBtn.title = isPausedMode ? "当前已关闭翻译，点击【开启中文翻译】" : "当前已开启翻译，点击【无感还原到原始语言】";
        leftBtn.style.color = isPausedMode ? "#1f883d" : "#5842f4";
    };
    updateLeftBtn();

    leftBtn.onclick = (ev) => {
        ev.stopImmediatePropagation();
        isPausedMode = !isPausedMode;
        GM_setValue('translator_paused', isPausedMode);
        document.documentElement.classList.toggle('translator-paused-mode', isPausedMode);
        updateLeftBtn();
    };

    // 2. 下方快捷切换按钮（控制替换与追加对照，显示“追”或“替”）
    let bottomBtn = document.createElement('div');
    bottomBtn.style = `position:absolute;right:11.5px;top:48px;height:28px;width:28px;background-color:#fff;border:1px solid #d0d7de;border-radius:14px;display:none;align-items:center;justify-content:center;cursor:pointer;font-size:13px;font-weight:bold;box-shadow:none;transition:all 0.15s ease;`;

    const updateBottomBtn = () => {
        bottomBtn.innerHTML = p.createHTML(isReplaceMode ? "追" : "替");
        bottomBtn.title = isReplaceMode ? "当前为【替换模式】，点击切换为【双语追加对照】" : "当前为【双语追加】，点击切换为【替换模式】";
        bottomBtn.style.color = isReplaceMode ? "#1f883d" : "#5842f4";
    };
    updateBottomBtn();

    bottomBtn.onclick = (ev) => {
        ev.stopImmediatePropagation();
        isReplaceMode = !isReplaceMode;
        GM_setValue('replace_translate', isReplaceMode);
        document.documentElement.classList.toggle('translator-replace-mode', isReplaceMode);
        updateBottomBtn();
        const panelInput = body.querySelector('input[name="replace_translate"]');
        if (panelInput) panelInput.checked = isReplaceMode;
    };

    // hover 鼠标移入/移出联动展示
    ballWrapper.onmouseenter = () => {
        leftBtn.style.display = 'flex';
        bottomBtn.style.display = 'flex';
    };
    ballWrapper.onmouseleave = () => {
        leftBtn.style.display = 'none';
        bottomBtn.style.display = 'none';
    };

    ballWrapper.appendChild(open);
    ballWrapper.appendChild(leftBtn);
    ballWrapper.appendChild(bottomBtn);

    // 6. 浮标平滑拖拽事件监听 & 稳健唤出面板
    let isDragging = false;
    let hasDragged = false;
    let startX = 0, startY = 0;
    let initialRight = 0, initialTop = 0;
    let lastToggleTime = 0;

    const togglePanel = () => {
        const now = Date.now();
        if (now - lastToggleTime < 250) return;
        lastToggleTime = now;
        if (mask.style.display === 'flex' || mask.style.display === 'block') {
            mask.style.display = 'none';
        } else {
            renderCurrentRule();
            mask.style.display = 'flex';
        }
    };

    open.onmousedown = function (e) {
        if (e.button !== 0) return;
        isDragging = true;
        hasDragged = false;
        startX = e.clientX;
        startY = e.clientY;

        const rect = ballWrapper.getBoundingClientRect();
        initialRight = window.innerWidth - rect.right;
        initialTop = rect.top;

        const onMouseMove = function (ev) {
            if (!isDragging) return;
            const deltaX = ev.clientX - startX;
            const deltaY = ev.clientY - startY;

            if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
                hasDragged = true;
                ev.preventDefault();
                ev.stopPropagation();
            }

            if (hasDragged) {
                const newRight = Math.max(0, initialRight - deltaX);
                const newTop = Math.max(0, Math.min(window.innerHeight - 45, initialTop + deltaY));
                ballWrapper.style.right = `${newRight}px`;
                ballWrapper.style.top = `${newTop}px`;
            }
        };

        const onMouseUp = function (ev) {
            if (!isDragging) return;
            isDragging = false;
            window.removeEventListener('mousemove', onMouseMove, true);
            window.removeEventListener('mouseup', onMouseUp, true);

            if (hasDragged) {
                GM_setValue("position_right", ballWrapper.style.right);
                GM_setValue("position_top", ballWrapper.style.top);
            } else {
                togglePanel();
            }
        };

        window.addEventListener('mousemove', onMouseMove, true);
        window.addEventListener('mouseup', onMouseUp, true);
    };

    open.onclick = (e) => {
        e.stopPropagation();
        if (!hasDragged) {
            togglePanel();
        }
        hasDragged = false;
    };

    open.addEventListener("touchstart", ev => {
        ev.stopImmediatePropagation();
        const touch = ev.touches[0];
        open._touchStart = { x: touch.clientX, y: touch.clientY };
        const rect = ballWrapper.getBoundingClientRect();
        open._touchBase = { right: window.innerWidth - rect.right, top: rect.top };
        open._touchMoved = false;
    }, { passive: true });

    open.addEventListener("touchmove", ev => {
        const touch = ev.touches[0];
        const dx = touch.clientX - open._touchStart.x;
        const dy = touch.clientY - open._touchStart.y;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
            open._touchMoved = true;
            ev.preventDefault();
        }
        if (open._touchMoved) {
            const newRight = Math.max(0, open._touchBase.right - dx);
            const newTop = Math.max(0, Math.min(window.innerHeight - 45, open._touchBase.top + dy));
            ballWrapper.style.right = `${newRight}px`;
            ballWrapper.style.top = `${newTop}px`;
        }
    });

    open.addEventListener("touchend", ev => {
        if (open._touchMoved) {
            GM_setValue("position_right", ballWrapper.style.right);
            GM_setValue("position_top", ballWrapper.style.top);
        } else {
            togglePanel();
        }
        open._touchMoved = false;
    });

    // 7. 全局自定义快捷键事件监听
    window.top.document.addEventListener('keydown', (e) => {
        if (!GM_getValue('enable_shortcuts', false)) return;
        const target = e.target;
        if (target && (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)) {
            return;
        }

        const parts = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        if (e.metaKey) parts.push('Meta');
        const key = e.key.toUpperCase();
        if (!['CONTROL', 'ALT', 'SHIFT', 'META'].includes(key)) {
            parts.push(key);
        }
        if (parts.length === 0) return;
        const currentCombo = parts.join('+');

        const sPause = GM_getValue('shortcut_toggle_pause', 'Alt+T');
        const sMode = GM_getValue('shortcut_toggle_mode', 'Alt+R');
        const sPanel = GM_getValue('shortcut_toggle_panel', 'Alt+P');

        if (currentCombo === sPause) {
            e.preventDefault();
            leftBtn.click();
        } else if (currentCombo === sMode) {
            e.preventDefault();
            bottomBtn.click();
        } else if (currentCombo === sPanel) {
            e.preventDefault();
            togglePanel();
        }
    });

    shadow.appendChild(ballWrapper);
    shadow.querySelector('.engine-select option[value="' + choice + '"]').selected = true;
    if (backupWrapper.querySelector('option[value="' + backupChoice + '"]')) {
        backupWrapper.querySelector('option[value="' + backupChoice + '"]').selected = true;
    }
    if (fullscrenn_hidden) window.top.document.addEventListener('fullscreenchange', () => { ballWrapper.style.display = window.top.document.fullscreenElement ? "none" : "flex"; });
}


const rules = [
    {
        name: '推特通用',
        matcher: /https:\/\/([a-zA-Z.]*?\.|)twitter\.com/,
        options: [
            {
                name: "推文",
                selector: baseSelector('div[dir="auto"][lang]'),
                textGetter: baseTextGetter,
                textSetter: options => {
                    options.element.style = options.element.style.cssText.replace(/-webkit-line-clamp.*?;/, '')
                    baseTextSetter(options).style.display = 'flex';
                }
            },
            {
                name: "背景信息",
                selector: baseSelector('div[data-testid=birdwatch-pivot]>div[dir=ltr]'),
                textGetter: baseTextGetter,
                textSetter: options => {
                    options.element.style = options.element.style.cssText.replace(/-webkit-line-clamp.*?;/, '')
                    baseTextSetter(options).style.display = 'flex';
                }
            }
        ]
    },
    {
        name: 'x通用',
        matcher: /https:\/\/([a-zA-Z.]*?.|)x\.com/,
        options: [
            {
                name: "推文",
                selector: baseSelector('div[dir="auto"][lang]'),
                textGetter: baseTextGetter,
                textSetter: options => {
                    options.element.style = options.element.style.cssText.replace(/-webkit-line-clamp.*?;/, '')
                    baseTextSetter(options).style.display = 'flex';
                }
            },
            {
                name: "背景信息",
                selector: baseSelector('div[data-testid=birdwatch-pivot]>div[dir=ltr]'),
                textGetter: baseTextGetter,
                textSetter: options => {
                    options.element.style = options.element.style.cssText.replace(/-webkit-line-clamp.*?;/, '')
                    baseTextSetter(options).style.display = 'flex';
                }
            }
        ]
    },
    {
        name: 'youtube pc通用',
        matcher: /https:\/\/www.youtube.com\/(watch|shorts|results\?)/,
        options: [
            {
                name: "评论区",
                selector: baseSelector("#content>#content-text"),
                textGetter: baseTextGetter,
                textSetter: options => {
                    baseTextSetter(options);
                    options.element.parentNode.parentNode.removeAttribute('collapsed');
                }
            },
            {
                name: "视频简介",
                selector: baseSelector("#content>#description>.content,.ytd-text-inline-expander>.yt-core-attributed-string"),
                textGetter: baseTextGetter,
                textSetter: options => {
                    baseTextSetter(options);
                    options.element.parentNode.parentNode.removeAttribute('collapsed');
                }
            },
            {
                name: "CC字幕",
                selector: baseSelector(".ytp-caption-segment"),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter
            }
        ]
    },
    {
        name: 'youtube mobile通用',
        matcher: /https:\/\/m.youtube.com\/watch/,
        options: [
            {
                name: "评论区",
                selector: baseSelector(".comment-text.user-text"),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            },
            {
                name: "视频简介",
                selector: baseSelector(".slim-video-metadata-description"),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            }
        ]
    },
    {
        name: 'youtube 短视频',
        matcher: /https:\/\/(www|m).youtube.com\/shorts/,
        options: [
            {
                name: "评论区",
                selector: baseSelector("#comment-content #content-text,.comment-content .comment-text"),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            }
        ]
    },
    {
        name: 'youtube 社区',
        matcher: /https:\/\/(www|m).youtube.com\/(.*?\/community|post)/,
        options: [
            {
                name: "评论区",
                selector: baseSelector("#post #content #content-text,#comment #content #content-text,#replies #content #content-text"),
                textGetter: baseTextGetter,
                textSetter: options => {
                    baseTextSetter(options);
                    options.element.parentNode.parentNode.removeAttribute('collapsed');
                }
            }
        ]
    },
    {
        name: 'facebook通用',
        matcher: /https:\/\/www.facebook.com\/.+/,
        options: [
            {
                name: "帖子内容",
                selector: baseSelector("div[data-ad-comet-preview=message],div[role=article] div[id]"),
                textGetter: baseTextGetter,
                textSetter: options => setTimeout(baseTextSetter, 0, options),
            },
            {
                name: "评论区",
                selector: baseSelector("div[role=article] div>span[dir=auto][lang]"),
                textGetter: baseTextGetter,
                textSetter: options => setTimeout(baseTextSetter, 0, options),
            }
        ]
    },
    {
        name: 'reddit通用',
        matcher: /https:\/\/www.reddit.com\/.*/,
        options: [
            {
                name: '帖子标题',
                selector: baseSelector("*[slot=title][id|=post-title]"),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            },
            {
                name: '帖子内容',
                selector: baseSelector("div[slot=text-body]>div>div[id*=-post-rtjson-content]"),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            },
            {
                name: '评论区',
                selector: baseSelector("div[slot=comment]>div[id$=-post-rtjson-content]"),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            }
            // a[data-click-id=body]:not([class=undefined]),.RichTextJSON-root
        ]
    },
    {
        name: '5ch评论',
        matcher: /http(|s):\/\/(.*?\.|)5ch.net\/.*/,
        options: [
            {
                name: "标题",
                selector: baseSelector('.post>.post-content,#threadtitle,.thread_title'),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            },
            {
                name: "内容",
                selector: baseSelector('.threadview_response_body'),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            }
        ]
    },
    {
        name: 'discord聊天',
        matcher: /https:\/\/discord.com\/.+/,
        options: [
            {
                name: "聊天内容",
                selector: baseSelector('div[class*=messageContent]'),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            }
        ]
    },
    {
        name: 'telegram聊天新',
        matcher: /https:\/\/.*?.telegram.org\/(a|z)\//,
        options: [
            {
                name: "聊天内容",
                selector: baseSelector('p.text-content[dir=auto],div.text-content'),
                textGetter: e => Array.from(e.childNodes).filter(item => !item.className).map(item => item.nodeName === "BR" ? "\n" : item.textContent).join(''),
                textSetter: baseTextSetter,
            }
        ]
    },
    {
        name: 'telegram聊天',
        matcher: /https:\/\/.*?.telegram.org\/.+/,
        options: [
            {
                name: "聊天内容",
                selector: baseSelector('div.message[dir=auto],div.im_message_text'),
                textGetter: e => Array.from(e.childNodes).filter(item => !item.className || item.className === 'translatable-message').map(item => item.nodeValue || item.innerText).join(" "),
                textSetter: baseTextSetter,
            }
        ]
    },
    {
        name: 'quora通用',
        matcher: /https:\/\/www.quora.com/,
        options: [
            {
                name: "标题",
                selector: baseSelector(".puppeteer_test_question_title>span>span"),
                textGetter: baseTextGetter,
                textSetter: options => {
                    options.element.parentNode.parentNode.style = options.element.parentNode.parentNode.style.cssText.replace(/-webkit-line-clamp.*?;/, '')
                    baseTextSetter(options).style.display = 'flex';
                },
            },
            {
                name: "帖子内容",
                selector: baseSelector('div.q-text>span>span.q-box:has(p.q-text),div.q-box>div.q-box>div.q-text>span.q-box:has(p.q-text)'),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            }
        ]
    },
    {
        name: 'tiktok评论',
        matcher: /https:\/\/www.tiktok.com/,
        options: [
            {
                name: "评论区",
                selector: baseSelector('p[data-e2e|=comment-level]'),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            }
        ]
    },
    {
        name: 'instagram评论',
        matcher: /https:\/\/www.instagram.com/,
        options: [
            {
                name: "评论区",
                selector: baseSelector('li>div>div>div>div>span[dir=auto]'),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            }
        ]
    },
    {
        name: 'threads',
        matcher: /https:\/\/www.threads.net/,
        options: [
            {
                name: "帖子",
                selector: baseSelector('div[data-pressable-container=true][data-interactive-id]>div>div:last-child>div>div:has(span[dir=auto]):not(:has(div[role=button]))'),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            }
        ]
    },
    {
        name: 'github',
        // 仅匹配仓库主页及分支根目录、所有.md结尾的文件，不匹配GitHub首页及Issues/PR等其他界面
        matcher: /^https:\/\/github\.com\/(?:search(?:\?.*)?$|[\w.-]+\/[\w.-]+(?:\/?(?:[?#].*)?$|\/tree\/[^\/\?#]+(?:\/?(?:[?#].*)?)?$|\/.*\.md(?:[?#].*)?$))/i,
        options: [
            {
                name: "正文段落",
                selector: baseSelector(".markdown-body p", items => items.filter(el => !el.closest('pre') && el.innerText.trim().length > 0)),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            },
            {
                name: "标题",
                selector: baseSelector(".markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6", items => items.filter(el => !el.closest('pre') && el.innerText.trim().length > 0)),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            },
            {
                name: "列表与引用",
                selector: baseSelector(".markdown-body li, .markdown-body blockquote", items => items.filter(el => !el.querySelector('p, table, ul, ol') && !el.closest('pre') && el.innerText.trim().length > 0)),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            },
            {
                name: "表格单元格",
                // 严格限制为叶子单元格：内部绝不包含嵌套 table、ul、ol、p，防止整个子表格被当成单元格吞噬隐藏
                selector: baseSelector(".markdown-body table td, .markdown-body table th", items => items.filter(el => !el.querySelector('table, ul, ol, p') && !el.closest('pre') && el.innerText.trim().length > 0)),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            },
            {
                name: "搜索结果描述",
                // 匹配 github.com/search 搜索页各仓库结果卡片的介绍内容
                selector: baseSelector('div[data-testid="results-list"] div[class*="resultContent"] > div[class*="Content"], ul.repo-list li p, div.search-title + p', items => items.filter(el => !el.closest('pre') && el.innerText.trim().length > 0)),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            },
        ]
    },
    {
        name: 'bsky',
        matcher: /https:\/\/bsky.app/,
        options: [
            {
                name: "主页帖子",
                selector: baseSelector('div[dir=auto][data-testid=postText]'),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            },
            {
                name: "内容帖子与回复",
                selector: baseSelector('div[data-testid^="postThreadItem-by"] div[dir=auto][data-word-wrap]'),
                textGetter: baseTextGetter,
                textSetter: baseTextSetter,
            }
        ]
    },
];

const GetActiveRule = () => rules.find(item => item.matcher.test(document.location.href) && GM_getValue('enable_rule:' + item.name, true));


(function () {
    'use strict';
    let url = document.location.href;
    let rule = GetActiveRule();
    setInterval(() => {
        if (document.location.href != url) {
            url = document.location.href;
            const ruleNew = GetActiveRule();
            if (ruleNew != rule) {
                if (ruleNew != null) {
                    console.log(`【翻译机】检测到URl变更，改为使用【${ruleNew.name}】规则`)
                } else {
                    console.log("【翻译机】检测到URl变更，当前无匹配规则")
                }
                rule = ruleNew;
            }
        }
    }, 200)
    console.log(rule ? `【翻译机】使用【${rule.name}】规则` : "【翻译机】当前无匹配规则");
    console.log(document.location.href)
    let engineStarted = {};
    async function doTranslateWithFailover(text, lang, primaryEngine, backupEngine, enableFailover) {
        let cached = sessionStorage.getItem(primaryEngine + '-' + text);
        if (cached) return { text: cached, engine: primaryEngine };

        if (enableFailover && backupEngine && backupEngine !== primaryEngine) {
            let backupCached = sessionStorage.getItem(backupEngine + '-' + text);
            if (backupCached) return { text: backupCached, engine: backupEngine };
        }

        const callEngine = (engine) => {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Timeout 6500ms')), 6500);
                try {
                    if (startup[engine] && !engineStarted[engine]) {
                        PromiseRetryWrap(startup[engine]).catch(() => {});
                        engineStarted[engine] = true;
                    }
                    const fn = transdict[engine];
                    if (!fn) return reject(new Error('Unknown engine: ' + engine));
                    fn(text, lang).then(res => {
                        clearTimeout(timer);
                        if (!res || typeof res !== 'string' || res.trim().length === 0) {
                            reject(new Error('Empty result'));
                        } else {
                            resolve(res);
                        }
                    }).catch(err => {
                        clearTimeout(timer);
                        reject(err);
                    });
                } catch (e) {
                    clearTimeout(timer);
                    reject(e);
                }
            });
        };

        try {
            const res = await callEngine(primaryEngine);
            return { text: res, engine: primaryEngine };
        } catch (err) {
            if (enableFailover && backupEngine && backupEngine !== primaryEngine) {
                console.warn(`[翻译机] 主引擎 [${primaryEngine}] 异常，自动容灾切换备用引擎 [${backupEngine}]:`, err);
                try {
                    const backupRes = await callEngine(backupEngine);
                    return { text: backupRes, engine: backupEngine };
                } catch (bErr) {
                    console.error(`[翻译机] 备用引擎 [${backupEngine}] 亦失败:`, bErr);
                    throw bErr;
                }
            }
            throw err;
        }
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
        }
        return fallbackCopy(text);
    }

    function fallbackCopy(text) {
        return new Promise((resolve, reject) => {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                ta.style.top = '-9999px';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    }

    function downloadMarkdown(md) {
        let docTitle = document.title.split(/[:\-\–]/)[0].trim() || 'translated_doc';
        docTitle = docTitle.replace(/[\\/:*?"<>|]/g, '_');
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${docTitle}_translated.md`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            if (a.parentNode) a.parentNode.removeChild(a);
            URL.revokeObjectURL(a.href);
        }, 500);
    }

    function getTranslatedMarkdown() {
        const root = document.querySelector(
            '.markdown-body, article.markdown-body, #readme, div[data-target="readme.body"], ' +
            'div[data-target="react-blob.renderedBlob"] .markdown-body, main article, article'
        );
        if (!root) {
            const codeLines = document.querySelectorAll('table.js-file-line-container td.js-file-line');
            if (codeLines.length > 0) {
                return Array.from(codeLines).map(td => td.textContent).join('\n');
            }
            return null;
        }

        const clone = root.cloneNode(true);

        clone.querySelectorAll('a.anchor, button, .js-clipboard-copy, .zeroclipboard-container, .translator-line-break').forEach(el => el.remove());

        const hasTranslation = clone.querySelector('.translator-result');
        if (hasTranslation) {
            clone.querySelectorAll('.translator-original').forEach(el => el.remove());
            clone.querySelectorAll('.translator-result').forEach(el => {
                el.outerHTML = el.innerHTML;
            });
        }

        function htmlToMd(node) {
            if (!node) return '';
            if (node.nodeType === Node.TEXT_NODE) return node.textContent;
            if (node.nodeType !== Node.ELEMENT_NODE) return '';

            const tag = node.tagName.toLowerCase();
            if (['script', 'style', 'noscript'].includes(tag)) return '';

            let inner = Array.from(node.childNodes).map(htmlToMd).join('');

            switch (tag) {
                case 'h1': return `\n# ${inner.trim()}\n\n`;
                case 'h2': return `\n## ${inner.trim()}\n\n`;
                case 'h3': return `\n### ${inner.trim()}\n\n`;
                case 'h4': return `\n#### ${inner.trim()}\n\n`;
                case 'h5': return `\n##### ${inner.trim()}\n\n`;
                case 'h6': return `\n###### ${inner.trim()}\n\n`;
                case 'p': return `\n${inner.trim()}\n\n`;
                case 'br': return `\n`;
                case 'strong':
                case 'b': return `**${inner.trim()}**`;
                case 'em':
                case 'i': return `*${inner.trim()}*`;
                case 'code':
                    if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') {
                        return inner;
                    }
                    return `\`${inner.trim()}\``;
                case 'pre': {
                    const codeNode = node.querySelector('code');
                    const lang = codeNode ? (codeNode.className.match(/language-(\\w+)/) || ['',''])[1] : '';
                    const codeText = codeNode ? codeNode.textContent : node.textContent;
                    return `\n\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n\n`;
                }
                case 'blockquote': return `\n> ${inner.trim().replace(/\n/g, '\n> ')}\n\n`;
                case 'ul': return `\n${inner}\n`;
                case 'ol': return `\n${inner}\n`;
                case 'li': {
                    const parent = node.parentElement ? node.parentElement.tagName.toLowerCase() : 'ul';
                    if (parent === 'ol') {
                        const idx = Array.from(node.parentElement.children).indexOf(node) + 1;
                        return `${idx}. ${inner.trim()}\n`;
                    }
                    return `- ${inner.trim()}\n`;
                }
                case 'a': {
                    const href = node.getAttribute('href') || '';
                    return `[${inner.trim()}](${href})`;
                }
                case 'img': {
                    const src = node.getAttribute('src') || '';
                    const alt = node.getAttribute('alt') || '';
                    return `![${alt}](${src})`;
                }
                case 'hr': return `\n---\n\n`;
                case 'table': {
                    const rows = Array.from(node.querySelectorAll('tr'));
                    if (rows.length === 0) return inner;
                    let mdTable = '\n';
                    rows.forEach((tr, rIdx) => {
                        const cells = Array.from(tr.querySelectorAll('th, td'));
                        mdTable += '| ' + cells.map(c => htmlToMd(c).replace(/[\r\n]+/g, ' ').trim()).join(' | ') + ' |\n';
                        if (rIdx === 0) {
                            mdTable += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
                        }
                    });
                    return mdTable + '\n';
                }
                default:
                    return inner;
            }
        }

        let md = htmlToMd(clone);
        md = md.replace(/\n{3,}/g, '\n\n').trim();
        return md;
    }

    // 自动将「复制译文」和「下载译文」注入 GitHub 原生工具栏
    function injectGitHubToolbarButtons() {
        if (!window.location.hostname.includes('github.com')) return;
        if (document.getElementById('gh-translator-copy-btn')) return;

        const rawBtn = document.querySelector(
            'a[data-testid="raw-button"], [data-testid="copy-raw-button"], [data-testid="download-raw-button"], ' +
            'button[aria-label="Copy raw content"], button[aria-label="Download raw content"], ' +
            'a#raw-url, a[href*="/raw/"]'
        );

        let targetContainer = null;
        let insertBeforeEl = null;

        if (rawBtn) {
            targetContainer = rawBtn.closest('div[class*="ButtonGroup"], div[class*="Box-header"] > div, div[style*="flex"], div[class*="prc-"]') || rawBtn.parentElement;
            insertBeforeEl = rawBtn;
        } else {
            const readmeHeader = document.querySelector('#readme .Box-header, #readme header, [data-target="readme.body"]')?.previousElementSibling || document.querySelector('#readme .Box-header');
            if (readmeHeader) {
                let rightBox = readmeHeader.querySelector('div[class*="Box-header"] > div, div[style*="flex"], div.d-flex, div[class*="prc-"]');
                targetContainer = rightBox || readmeHeader;
            }
        }

        if (!targetContainer) return;

        const btnGroup = document.createElement('div');
        btnGroup.id = 'gh-translator-btn-group';

        const copySvg = '<svg viewBox="0 0 16 16"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>';
        const dlSvg = '<svg viewBox="0 0 16 16"><path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z"></path><path d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.969a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.78a.749.749 0 1 1 1.06-1.06l1.97 1.969Z"></path></svg>';

        const copyBtn = document.createElement('button');
        copyBtn.id = 'gh-translator-copy-btn';
        copyBtn.className = 'translator-gh-btn';
        copyBtn.title = '复制当前已翻译的 Markdown 内容';
        copyBtn.innerHTML = p.createHTML(copySvg + '<span>复制译文</span>');
        copyBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const md = getTranslatedMarkdown();
            if (!md) {
                alert('未检测到可导出的 Markdown 结构（请确认当前页面有 README 或正文）');
                return;
            }
            copyToClipboard(md).then(() => {
                copyBtn.innerHTML = p.createHTML('✅ <span>已复制译文</span>');
                setTimeout(() => {
                    copyBtn.innerHTML = p.createHTML(copySvg + '<span>复制译文</span>');
                }, 2000);
            });
        };

        const dlBtn = document.createElement('button');
        dlBtn.id = 'gh-translator-download-btn';
        dlBtn.className = 'translator-gh-btn';
        dlBtn.title = '下载当前已翻译的 .md 文件';
        dlBtn.innerHTML = p.createHTML(dlSvg + '<span>下载译文</span>');
        dlBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const md = getTranslatedMarkdown();
            if (!md) {
                alert('未检测到可导出的 Markdown 结构');
                return;
            }
            downloadMarkdown(md);
            dlBtn.innerHTML = p.createHTML('✅ <span>已下载</span>');
            setTimeout(() => {
                dlBtn.innerHTML = p.createHTML(dlSvg + '<span>下载译文</span>');
            }, 2000);
        };

        btnGroup.appendChild(copyBtn);
        btnGroup.appendChild(dlBtn);

        if (insertBeforeEl && insertBeforeEl.parentNode === targetContainer) {
            targetContainer.insertBefore(btnGroup, insertBeforeEl);
        } else {
            targetContainer.appendChild(btnGroup);
        }
    }


    let main = _ => {
        if (isPausedMode || !rule) return;
        const choice = GM_getValue('translate_choice', '谷歌翻译');
        const backupChoice = GM_getValue('translate_backup_choice', '必应翻译');
        const enableFailover = GM_getValue('enable_failover', true);

        for (const option of rule.options) {
            if (!GM_getValue("enable_option:" + rule.name + "-" + option.name, true)) {
                continue;
            }
            const temp = [...new Set(option.selector())];
            for (let i = 0; i < temp.length; i++) {
                const now = temp[i];
                if (globalProcessingSave.includes(now)) continue;
                globalProcessingSave.push(now);
                const rawText = option.textGetter(now);
                const text = remove_url ? url_filter(rawText) : rawText;
                if (text.length == 0) continue;
                const setterParams = {
                    element: now,
                    translatorName: choice,
                    rawText: rawText,
                    rule: rule,
                    option: option
                };

                pass_lang(text).then(lang => {
                    return doTranslateWithFailover(text, lang, choice, backupChoice, enableFailover);
                }).then(({ text: s, engine }) => {
                    setterParams.translatorName = engine;
                    setterParams.text = s;
                    option.textSetter(setterParams);
                    removeItem(globalProcessingSave, now);
                }).catch(err => {
                    removeItem(globalProcessingSave, now);
                    delete now.dataset.translate;
                });
            }
        }
    };
    PromiseRetryWrap(startup[GM_getValue('translate_choice', '谷歌翻译')]).then(() => {
        document.js_translater = setInterval(main, 80);
        setInterval(injectGitHubToolbarButtons, 1000);
    });
    if(!GM_getValue('show_translate_ball',true))return;
    initPanel();
})();

//--综合工具区--start

function removeItem(arr, item) {
    const index = arr.indexOf(item);
    if (index > -1) arr.splice(index, 1);
}

function baseSelector(selector,customFilter) {
    return () => {
        const items = document.querySelectorAll(selector);
        let filterResult = Array.from(items).filter(item => {
            const nodes = item.querySelectorAll('[data-translate]');
            return !item.dataset.translate && !(nodes && Array.from(nodes).some(node => node.parentNode === item));
        })
        if(customFilter){
            filterResult = customFilter(filterResult);
        }
        filterResult.map(item => item.dataset.translate = "processed");
        return filterResult;
    }
}

function baseTextGetter(e) {
    return e.innerText;
}

function restoreLinks(textSpan, origSpan, rawText, translatedText, isTableCell) {
    const origLinks = Array.from(origSpan.querySelectorAll('a')).filter(a => a.href && a.innerText.trim().length > 0);
    if (origLinks.length === 0) {
        textSpan.innerText = translatedText;
        return;
    }

    // 场景 1：单元格内或段落内整体主要就是该链接（如表格、列表、按钮、标题链接）
    if (origLinks.length === 1 && (origLinks[0].innerText.trim() === rawText.trim() || rawText.length < origLinks[0].innerText.length + 6 || isTableCell)) {
        const aClone = origLinks[0].cloneNode(false);
        aClone.innerText = translatedText;
        textSpan.appendChild(aClone);
        return;
    }

    // 场景 2：段落内包含多个超链接
    // 优先匹配在译文中保留原词的链接（如域名 vuejs.org、npm、包名、英文专有名词等）
    const restoredA = [];
    for (const link of origLinks) {
        const linkWord = link.innerText.trim();
        if (linkWord.length > 1 && translatedText.includes(linkWord)) {
            restoredA.push({ link, word: linkWord });
        }
    }

    if (restoredA.length > 0) {
        restoredA.sort((a, b) => b.word.length - a.word.length);
        const regexParts = restoredA.map(item => item.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const regex = new RegExp(`(${regexParts.join('|')})`, 'g');
        const parts = translatedText.split(regex);

        for (const part of parts) {
            const matched = restoredA.find(item => item.word === part);
            if (matched) {
                const a = matched.link.cloneNode(false);
                a.innerText = part;
                textSpan.appendChild(a);
            } else if (part.length > 0) {
                textSpan.appendChild(document.createTextNode(part));
            }
        }
    } else {
        textSpan.innerText = translatedText;
    }

    // 对于在译文中被意译、未能直接以英文词匹配上的链接，在末尾附带紧凑的小角标链接，确保替换模式下随时可点击跳转
    const unmatchedLinks = origLinks.filter(link => !restoredA.some(r => r.link === link));
    if (unmatchedLinks.length > 0) {
        const badgeWrap = document.createElement('span');
        badgeWrap.style.marginLeft = '4px';
        badgeWrap.style.fontSize = '0.9em';
        for (const link of unmatchedLinks) {
            const a = link.cloneNode(false);
            a.style.marginLeft = '3px';
            a.innerText = `[${link.innerText.trim()}]`;
            badgeWrap.appendChild(a);
        }
        textSpan.appendChild(badgeWrap);
    }
}

function baseTextSetter({ element, translatorName, text, rawText, rule, option }) {
    if ((text || "").length == 0) text = '翻译异常';
    const currentShowInfo = GM_getValue("option_setting:show_info:" + rule.name + "-" + option.name, show_info);
    const isTableCell = element.tagName === 'TD' || element.tagName === 'TH';

    // 1. 将 element 现有的所有子节点包裹到 .translator-original 中，完整保留原 HTML 结构和事件
    const origSpan = document.createElement('span');
    origSpan.className = 'translator-original';
    while (element.firstChild) {
        origSpan.appendChild(element.firstChild);
    }
    element.appendChild(origSpan);

    // 2. 创建翻译结果节点
    const resSpan = document.createElement('span');
    resSpan.className = 'translator-result translate-processed-node';
    resSpan.dataset.translate = "processed";
    resSpan.title = rawText;

    // 换行分隔（表格单元格使用紧凑的 <br>，普通段落使用弹性间距 <div>，替换模式下被 CSS 自动隐藏）
    const breakEl = isTableCell ? document.createElement('br') : document.createElement('div');
    breakEl.className = 'translator-break';
    if (!isTableCell) {
        breakEl.style.height = '0.5em';
    }

    const textSpan = document.createElement('span');
    textSpan.className = 'translator-text';
    const infoPrefix = currentShowInfo ? (isTableCell ? `[${translatorName}] ` : `-----------${translatorName}-----------\n`) : "";
    const cleanTranslatedText = infoPrefix + text.trim();

    // 智能恢复超链接：将原本存在的 <a> 标签智能注入到译文中，确保替换模式下仍可点击跳转
    restoreLinks(textSpan, origSpan, rawText, cleanTranslatedText, isTableCell);

    if (!isTableCell) {
        textSpan.style.whiteSpace = "pre-wrap";
    }

    resSpan.appendChild(breakEl);
    resSpan.appendChild(textSpan);
    element.appendChild(resSpan);

    // 仅对普通块元素移除溢出限制，绝不对表格单元格注入强制行内样式，保持表格天然排版
    if (!isTableCell) {
        element.style.cssText += "-webkit-line-clamp: unset;max-height: unset";
    }
    return resSpan;
}

function url_filter(text) {
    return text.replace(/(https?|ftp|file):\/\/[-A-Za-z0-9+&@#/%?=~_|!:,.;]+[-A-Za-z0-9+&@#/%=~_|]/g, '');
}

async function pass_lang(raw) {//确认是否为中文，是则中断promise
    if (!enable_pass_lang && !enable_pass_lang_cht) return;
    try {
        const result = await check_lang(raw)
        if (enable_pass_lang && result == 'zh') return new Promise(() => { });
        if (enable_pass_lang_cht && (result == 'cht'|| result == 'zh-tw')) return new Promise(() => { });
        return result
    } catch (err) {
        console.log(err);
        return
    }
    return
}

async function check_lang(raw) {
    let t = Date.now();
    const options = {
        method: "POST",
        url: 'https://fanyi.baidu.com/langdetect',
        data: 'query=' + encodeURIComponent(raw.replace(/[\uD800-\uDBFF]$/, "").slice(0, 50)),
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        }
    }
    const res = await Request(options);
    //console.log(`语言加载完毕，耗时${Date.now()-t}ms`)
    try {
        return JSON.parse(res.responseText).lan
    } catch (err) {
        console.log(err);
        return
    }
    // let t = Date.now();
    //const options = {
    //    method: "GET",
    //    url: 'https://translate.alibaba.com/trans/GetDetectLanguage.do?srcData='+encodeURIComponent(raw.replace(/[\uD800-\uDBFF]$/, "").slice(0, 50)),
    //}
    //const res = await Request(options);
    //console.log(options,res.responseText);
    //// console.log(`语言加载完毕，耗时${Date.now()-t}ms`)
    //try {
    //    return JSON.parse(res.responseText).renognize
    //} catch (err) {
    //    console.log(err);
    //    return
    //}
}


function guid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        let r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

//--综合工具区--end

//--谷歌翻译--start
async function translate_gg(raw) {
    const options = {
        method: "GET",
        url: `https://translate.google.com/translate_a/t?client=gtx&sl=auto&tl=zh-CN&q=` + encodeURIComponent(raw),
        anonymous: true,
        nocache: true,
    }
    return await BaseTranslate('谷歌翻译', raw, options, res => JSON.parse(res)[0][0])
}

//--谷歌翻译--end

//--谷歌翻译mobile--start
async function translate_ggm(raw) {
    const options = {
        method: "GET",
        url: "https://translate.google.com/m?tl=zh-CN&q=" + encodeURIComponent(raw),
        headers: {
            "Host": "translate.google.com",
        },
        anonymous: true,
        nocache: true,
    }
    return await BaseTranslate('谷歌翻译mobile', raw, options, res => /class="result-container">((?:.|\n)*?)<\/div/.exec(res)[1])
}
//--谷歌翻译mobile--end

//--百度翻译--start
async function translate_baidu(raw, lang) {
    if (!lang) {
        lang = await check_lang(raw)
    }
    const options = {
        method: "POST",
        url: 'https://fanyi.baidu.com/ait/text/translate',
        data: JSON.stringify({ query: raw, from: lang, to: "zh" }),
        headers: {
            "referer": 'https://fanyi.baidu.com',
            'Content-Type': 'application/json',
            'Origin': 'https://fanyi.baidu.com',
            'accept': 'text/event-stream',
        },
    }
    return await BaseTranslate('百度翻译', raw, options, res => res.split('\n').filter(item => item.startsWith('data: ')).map(item => JSON.parse(item.slice(6))).find(item => item.data.list).data.list.map(item => item.dst).join('\n'))
}

//--百度翻译--end

//--爱词霸翻译--start

async function translate_icib(raw) {
    const sign = CryptoJS.MD5("6key_web_fanyi" + "ifanyiweb8hc9s98e" + raw.replace(/(^\s*)|(\s*$)/g, "")).toString().substring(0, 16)
    const options = {
        method: "POST",
        url: `https://ifanyi.iciba.com/index.php?c=trans&m=fy&client=6&auth_user=key_web_fanyi&sign=${sign}`,
        data: 'from=auto&t=zh&q=' + encodeURIComponent(raw),
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
    }
    return await BaseTranslate('爱词霸翻译', raw, options, res => JSON.parse(res).content.out)
}

//--爱词霸翻译--end


//--必应翻译--start

async function translate_biying(raw) {
    const options = {
        method: "POST",
        url: 'https://www.bing.com/ttranslatev3',
        data: 'fromLang=auto-detect&to=zh-Hans&text=' + encodeURIComponent(raw),
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
    }
    return await BaseTranslate('必应翻译', raw, options, res => JSON.parse(res)[0].translations[0].text)
}

//--必应翻译--end

//--有道翻译--start
async function translate_youdao_startup() {
    if (sessionStorage.getItem('youdao_key')) return;
    const ts = "" + (new Date).getTime();
    const params = {
        keyid: "webfanyi-key-getter",
        client: "fanyideskweb",
        product: "webfanyi",
        appVersion: "1.0.0",
        vendor: "web",
        pointParam: "client,mysticTime,product",
        mysticTime: ts,
        keyfrom: "fanyi.web",
        sign: CryptoJS.MD5(`client=fanyideskweb&mysticTime=${ts}&product=webfanyi&key=asdjnjfenknafdfsdfsd`)
    }
    const options = {
        method: "GET",
        url: `https://dict.youdao.com/webtranslate/key?${Object.entries(params).map(item => item.join('=')).join('&')}`,
        headers: {
            "Origin": "https://fanyi.youdao.com"
        }
    }
    const res = await Request(options);
    sessionStorage.setItem('youdao_key', JSON.parse(res.responseText).data.secretKey)
}

async function translate_youdao(raw) {
    const ts = "" + (new Date).getTime();
    const params = {
        i: encodeURIComponent(raw),
        from: 'auto',
        to: '',
        dictResult: 'true',
        keyid: "webfanyi",
        client: "fanyideskweb",
        product: "webfanyi",
        appVersion: "1.0.0",
        vendor: "web",
        pointParam: "client,mysticTime,product",
        mysticTime: ts,
        keyfrom: "fanyi.web",
        sign: CryptoJS.MD5(`client=fanyideskweb&mysticTime=${ts}&product=webfanyi&key=${sessionStorage.getItem('youdao_key')}`) + ''
    }
    const options = {
        method: "POST",
        url: 'https://dict.youdao.com/webtranslate',
        data: Object.entries(params).map(item => item.join('=')).join('&'),
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": "https://fanyi.youdao.com/",
            "Origin": "https://fanyi.youdao.com",
            "Host": "dict.youdao.com",
            "Cookie": "OUTFOX_SEARCH_USER_ID=0@0.0.0.0"
        },
        anonymous: true,
    }
    const res = await Request(options);
    const decrypted = A(res);
    return await BaseTranslate('有道翻译', raw, options, res => JSON.parse(A(res)).translateResult.map(e => e.map(t => t.tgt).join('')).join('\n'))
}

function m(e) {
    return CryptoJS.MD5(e).toString(CryptoJS.enc.Hex);
}

function A(t, o, n) {
    o = "ydsecret://query/key/BRGygVywfNBwpmBaZgWT7SIOUP2T0C9WHMZN39j^DAdaZhAnxvGcCY6VYFwnHl"
    n = "ydsecret://query/iv/C@lZe2YzHtZ2CYgaXKSVfsb7Y4QWHjITPPZ0nQp87fBeJ!Iv6v^6fvi2WN@bYpJ4"
    if (!t)
        return null;
    const a = CryptoJS.enc.Hex.parse(m(o)),
          r = CryptoJS.enc.Hex.parse(m(n)),
          i = CryptoJS.AES.decrypt(t, a, {
              iv: r
          });
    return i.toString(CryptoJS.enc.Utf8);
}

//--有道翻译--end

//--有道翻译m--start
async function translate_youdao_mobile(raw) {
    const options = {
        method: "POST",
        url: 'http://m.youdao.com/translate',
        data: "inputtext=" + encodeURIComponent(raw) + "&type=AUTO",
        anonymous: true,
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        }
    }
    return await BaseTranslate('有道翻译mobile', raw, options, res => /id="translateResult">\s*?<li>([\s\S]*?)<\/li>\s*?<\/ul/.exec(res)[1])
}
//--有道翻译m--end

//--腾讯翻译--start

async function translate_tencent_startup() {
    setTimeout(translate_tencent_startup, 10000)//token刷新
    const base_options = {
        method: 'GET',
        url: 'http://fanyi.qq.com',
        anonymous: true,
        headers: {
            "User-Agent": "test",
        }
    }
    const base_res = await Request(base_options)
    const uri = /reauthuri = "(.*?)"/.exec(base_res.responseText)[1]
    const options = {
        method: 'POST',
        url: 'https://fanyi.qq.com/api/' + uri
    }
    const res = await Request(options);
    const data = JSON.parse(res.responseText);
    sessionStorage.setItem('tencent_qtv', data.qtv)
    sessionStorage.setItem('tencent_qtk', data.qtk)
}


async function translate_tencent(raw) {
    const qtk = sessionStorage.getItem('tencent_qtk'), qtv = sessionStorage.getItem('tencent_qtv');
    const options = {
        method: 'POST',
        url: 'https://fanyi.qq.com/api/translate',
        data: `source=auto&target=zh&sourceText=${encodeURIComponent(raw)}&qtv=${encodeURIComponent(qtv)}&qtk=${encodeURIComponent(qtk)}&sessionUuid=translate_uuid${Date.now()}`,
        headers: {
            "Host": "fanyi.qq.com",
            "Origin": "https://fanyi.qq.com",
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": "https://fanyi.qq.com/",
            "X-Requested-With": "XMLHttpRequest",
        }
    }
    return await BaseTranslate('腾讯翻译', raw, options, res => JSON.parse(res).translate.records.map(e => e.targetText).join(''))
}

//--腾讯翻译--end

//--彩云翻译--start

async function translate_caiyun_startup() {
    if (sessionStorage.getItem('caiyun_id') && sessionStorage.getItem('caiyun_jwt')) return;
    const browser_id = CryptoJS.MD5(Math.random().toString()).toString();
    sessionStorage.setItem('caiyun_id', browser_id);
    const options = {
        method: "POST",
        url: 'https://api.interpreter.caiyunai.com/v1/user/jwt/generate',
        headers: {
            "Content-Type": "application/json",
            "X-Authorization": "token:qgemv4jr1y38jyq6vhvi",
            "Origin": "https://fanyi.caiyunapp.com",
        },
        data: JSON.stringify({ browser_id }),
    }
    const res = await Request(options);
    sessionStorage.setItem('caiyun_jwt', JSON.parse(res.responseText).jwt);
}

async function translate_caiyun(raw) {
    const source = "NOPQRSTUVWXYZABCDEFGHIJKLMnopqrstuvwxyzabcdefghijklm";
    const dic = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"].reduce((dic, current, index) => { dic[current] = source[index]; return dic }, {});
    const decoder = line => Base64.decode([...line].map(i => dic[i] || i).join(""))
    const options = {
        method: "POST",
        url: 'https://api.interpreter.caiyunai.com/v1/translator',
        data: JSON.stringify({
            "source": raw.split('\n'),
            "trans_type": "auto2zh",
            "detect": true,
            "browser_id": sessionStorage.getItem('caiyun_id')
        }),
        headers: {
            "Content-Type": "application/json",
            "X-Authorization": "token:qgemv4jr1y38jyq6vhvi",
            "T-Authorization": sessionStorage.getItem('caiyun_jwt')
        }
    }
    return await BaseTranslate('彩云小译', raw, options, res => JSON.parse(res).target.map(decoder).join('\n'))
}

//--彩云翻译--end

//--papago翻译--start

async function translate_papago_startup() {
    if (sessionStorage.getItem('papago_key')) return;
    const base_options = {
        method: 'GET',
        url: 'https://papago.naver.com/',
        anonymous: true,
    }
    const base_res = await Request(base_options)
    const uri = /"\/(vendors~home\..*?.chunk.js)"/.exec(base_res.responseText)[1]
    const options = {
        method: 'GET',
        url: 'https://papago.naver.com/' + uri
    }
    const res = await Request(options);
    const key = /AUTH_KEY:"(.*?)"/.exec(res.responseText)[1];
    sessionStorage.setItem('papago_key', key);
}

async function translate_papago(raw) {
    const time = Date.now();
    const options = {
        method: 'POST',
        url: 'https://papago.naver.com/apis/n2mt/translate',
        data: `deviceId=${time}&source=auto&target=zh-CN&text=${encodeURIComponent(raw)}`,
        headers: {
            "authorization": 'PPG ' + time + ':' + CryptoJS.HmacMD5(time + '\nhttps://papago.naver.com/apis/n2mt/translate\n' + time, sessionStorage.getItem('papago_key')).toString(CryptoJS.enc.Base64),
            "x-apigw-partnerid": "papago",
            "device-type": 'pc',
            "timestamp": time,
            "Content-Type": "application/x-www-form-urlencoded",
        }
    }
    return await BaseTranslate('Papago', raw, options, res => JSON.parse(res).translatedText)
}

//--papago翻译--end

//--阿里翻译--start
async function translate_alibaba(raw) {
    const options = {
        method: 'POST',
        url: 'https://translate.alibaba.com/translationopenseviceapp/trans/TranslateTextAddAlignment.do',
        data: `srcLanguage=auto&tgtLanguage=zh&bizType=message&srcText=${encodeURIComponent(raw)}`,
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "origin": "https://translate.alibaba.com",
            "referer": "https://translate.alibaba.com/",
            "sec-fetch-site": "same-origin",
        }
    }
    return await BaseTranslate('阿里翻译', raw, options, res => JSON.parse(res).listTargetText[0])
}
//--阿里翻译--end

//--Deepl翻译--start

function getTimeStamp(iCount) {
    const ts = Date.now();
    if (iCount !== 0) {
        iCount = iCount + 1;
        return ts - (ts % iCount) + iCount;
    } else {
        return ts;
    }
}

async function translate_deepl(raw) {
    const id = (Math.floor(Math.random() * 99999) + 100000) * 1000;
    const data = {
        jsonrpc: '2.0',
        method: 'LMT_handle_texts',
        id,
        params: {
            splitting: 'newlines',
            lang: {
                source_lang_user_selected: 'auto',
                target_lang: 'ZH',
            },
            texts: [{
                text: raw,
                requestAlternatives: 3
            }],
            timestamp: getTimeStamp(raw.split('i').length - 1)
        }
    }
    let postData = JSON.stringify(data);
    if ((id + 5) % 29 === 0 || (id + 3) % 13 === 0) {
        postData = postData.replace('"method":"', '"method" : "');
    } else {
        postData = postData.replace('"method":"', '"method": "');
    }
    const options = {
        method: 'POST',
        url: 'https://www2.deepl.com/jsonrpc',
        data: postData,
        headers: {
            'Content-Type': 'application/json',
            'Host': 'www.deepl.com',
            'Origin': 'https://www.deepl.com',
            'Referer': 'https://www.deepl.com/'
        },
        anonymous: true,
        nocache: true,
    }
    return await BaseTranslate('Deepl翻译', raw, options, res => JSON.parse(res).result.texts[0].text)
}

//--Deepl翻译--end

//--腾讯AI翻译--start
async function translate_tencentai(raw) {
    const data = {
        "header": {
            "fn": "auto_translation",
            "client_key": `browser-chrome-121.0.0-Windows_10-${guid()}-${Date.now()}`,
            "session": "",
            "user": ""
        },
        "type": "plain",
        "model_category": "normal",
        "text_domain": "",
        "source": {
            "lang": "auto",
            "text_list": [raw]
        },
        "target": {
            "lang": "zh"
        }
    }
    const options = {
        method: 'POST',
        url: 'https://transmart.qq.com/api/imt',
        data: JSON.stringify(data),
        headers: {
            'Content-Type': 'application/json',
            'Host': 'transmart.qq.com',
            'Origin': 'https://transmart.qq.com',
            'Referer': 'https://transmart.qq.com/'
        },
        anonymous: true,
        nocache: true,
    }
    return await BaseTranslate('腾讯AI翻译', raw, options, res => JSON.parse(res).auto_translation[0])
}
//--腾讯Ai翻译--end

//--异步请求包装工具--start

async function PromiseRetryWrap(task, options, ...values) {
    const { RetryTimes, ErrProcesser } = options || {};
    let retryTimes = RetryTimes || 5;
    const usedErrProcesser = ErrProcesser || (err => { throw err });
    if (!task) return;
    while (true) {
        try {
            return await task(...values);
        } catch (err) {
            if (!--retryTimes) {
                console.log(err);
                return usedErrProcesser(err);
            }
        }
    }
}

async function BaseTranslate(name, raw, options, processer) {
    const toDo = async () => {
        var tmp;
        try {
            const data = await Request(options);
            tmp = data.responseText;
            const result = await processer(tmp);
            if (result){
                setTimeout(()=>sessionStorage.setItem(name + '-' + raw, result),0);
            }
            return result
        } catch (err) {
            throw {
                responseText: tmp,
                err: err
            }
        }
    }
    return await PromiseRetryWrap(toDo, { RetryTimes: 3, ErrProcesser: () => "翻译出错" })
}

function Request(options) {
    return new Promise((reslove, reject) => GM_xmlhttpRequest({ ...options, onload: reslove, onerror: reject }))
}

//--异步请求包装工具--end

//--压缩存储--start

function CompressMergeSession(rawSession,compress) {
    const rawCache = rawSession.getItem('translate-merge-cache')
    const cache = JSON.parse(rawCache?(LZString.decompress(rawCache)||'{}'):'{}');
    window.addEventListener('storage',e=>{
        if(e && e.key && e.key.startsWith('translate-merge-cache-sync')){
            const key = e.newValue.slice(0,32);
            const value = e.newValue.slice(32);
            cache[key]=value;
        }
    })
    return {
        getItem: (key) => {
            return cache[CryptoJS.MD5(key).toString()] || "";
        },
        setItem: (key, value) => {
            const hashKey = CryptoJS.MD5(key).toString();
            cache[hashKey]=value;
            localStorage.setItem('translate-merge-cache-sync',hashKey+value);
            const rawSaveValue = JSON.stringify(cache);
            const saveValue = LZString.compress(rawSaveValue);
            // console.log(`压缩前:${rawSaveValue.length},压缩后:${saveValue.length},压缩率:${saveValue.length/rawSaveValue.length}`)
            rawSession.setItem('translate-merge-cache',saveValue)
        }
    }
}

//--压缩存储--end
