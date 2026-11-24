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
`;
(document.head || document.documentElement).appendChild(instantStyle);

function initPanel() {
    let choice = GM_getValue('translate_choice', '谷歌翻译');

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

    // 模块 A：翻译引擎选择
    let engineSection = document.createElement('div');
    engineSection.className = 'translator-section';
    engineSection.innerHTML = p.createHTML('<div class="translator-section-title">翻译引擎 (服务源)</div>');

    let selectWrapper = document.createElement('div');
    selectWrapper.className = 'engine-select-wrapper';

    let select = document.createElement("select");
    select.className = 'engine-select';
    select.onchange = () => {
        GM_setValue('translate_choice', select.value);
        const titleSpan = titleBox.querySelector('#panel_title_text');
        if (titleSpan) titleSpan.innerText = "控制面板 (已切换，刷新应用)";
    };
    for (let i in transdict) {
        select.innerHTML = p.createHTML(select.innerHTML + '<option value="' + i + '">' + i + '</option>');
    }
    selectWrapper.appendChild(select);
    engineSection.appendChild(selectWrapper);
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

    // 模块 C：当前启用规则的个性化配置
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

    // 模块 D：支持的网站规则列表（升级为 3 列网格紧凑标签）
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

    // 注入极简扁平 CSS（3列网格、完美原生滚轮支持）
    let panelStyle = document.createElement('style');
    panelStyle.textContent = `
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .translator-mask {
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: transparent;
            z-index: 99999; display: none; visibility: visible !important;
        }
        .translator-dialog {
            position: fixed; width: 380px; max-width: 95vw; max-height: 82vh;
            background: #ffffff; border: 1px solid #d0d7de; border-radius: 8px;
            box-shadow: none; display: flex; flex-direction: column;
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
        .engine-select-wrapper { width: 100%; }
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
        
        /* 3 列紧凑网格布局 */
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

    const updateDialogPosition = () => {
        const ballRect = ballWrapper.getBoundingClientRect();
        const dialogWidth = 380;
        let right = (window.innerWidth - ballRect.left) + 8;
        if (right + dialogWidth > window.innerWidth) {
            right = Math.max(10, window.innerWidth - dialogWidth - 10);
        }
        let top = ballRect.top;
        if (top + 450 > window.innerHeight) {
            top = Math.max(10, window.innerHeight - 460);
        }
        dialog.style.right = `${Math.max(10, right)}px`;
        dialog.style.top = `${Math.max(10, top)}px`;
    };

    const togglePanel = () => {
        const now = Date.now();
        if (now - lastToggleTime < 250) return;
        lastToggleTime = now;
        if (mask.style.display === 'block') {
            mask.style.display = 'none';
        } else {
            renderCurrentRule();
            updateDialogPosition();
            mask.style.display = 'block';
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

    shadow.appendChild(ballWrapper);
    shadow.querySelector('.engine-select option[value=' + choice + ']').selected = true;
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
    let main = _ => {
        if (isPausedMode || !rule) return;
        const choice = GM_getValue('translate_choice', '谷歌翻译');
        for (const option of rule.options) {
            if (!GM_getValue("enable_option:" + rule.name + "-" + option.name, true)) {
                continue
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
                }
                if (sessionStorage.getItem(choice + '-' + text)) {
                    setterParams.text = sessionStorage.getItem(choice + '-' + text)
                    option.textSetter(setterParams);
                    removeItem(globalProcessingSave, now)
                } else {
                    pass_lang(text).then(lang => transdict[choice](text, lang)).then(s => {
                        setterParams.text = s
                        option.textSetter(setterParams);
                        removeItem(globalProcessingSave, now);
                    })
                }
            }
        }
    };
    PromiseRetryWrap(startup[GM_getValue('translate_choice', '谷歌翻译')]).then(() => { document.js_translater = setInterval(main, 80) });
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
