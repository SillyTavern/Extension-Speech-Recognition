/*
TODO:
 - try pseudo streaming audio by just sending chunk every X seconds and asking VOSK if it is full text.
*/

import { saveSettingsDebounced, sendMessageAsUser } from '../../../../script.js';
import { getContext, extension_settings, ModuleWorkerWrapper } from '../../../extensions.js';
import { VoskSttProvider } from './vosk.js';
import { WhisperExtrasSttProvider } from './whisper-extras.js';
import { WhisperOpenAISttProvider } from './whisper-openai.js';
import { WhisperLocalSttProvider } from './whisper-local.js';
import { BrowserSttProvider } from './browser.js';
import { StreamingSttProvider } from './streaming.js';
import { VAD } from './vad.js'
export { MODULE_NAME };

const MODULE_NAME = 'Speech Recognition';
const DEBUG_PREFIX = '<Speech Recognition module> ';
const UPDATE_INTERVAL = 100;

let inApiCall = false;

let sttProviders = {
    None: null,
    Browser: BrowserSttProvider,
    'Whisper (Extras)': WhisperExtrasSttProvider,
    'Whisper (OpenAI)': WhisperOpenAISttProvider,
    'Whisper (Local)': WhisperLocalSttProvider,
    Vosk: VoskSttProvider,
    Streaming: StreamingSttProvider,
};

let sttProvider = null;
let sttProviderName = 'None';

let audioRecording = false;
const constraints = { audio: { sampleSize: 16, channelCount: 1, sampleRate: 16000 } };
let audioChunks = [];

async function moduleWorker() {
    if (sttProviderName != 'Streaming') {
        return;
    }

    // API is busy
    if (inApiCall) {
        return;
    }

    try {
        inApiCall = true;
        const userMessageOriginal = await sttProvider.getUserMessage();
        let userMessageFormatted = userMessageOriginal.trim();

        if (userMessageFormatted.length > 0) {
            console.debug(DEBUG_PREFIX + 'recorded transcript: "' + userMessageFormatted + '"');

            let userMessageLower = userMessageFormatted.toLowerCase();
            // remove punctuation
            let userMessageRaw = userMessageLower.replace(/[^\w\s\']|_/g, '').replace(/\s+/g, ' ');

            console.debug(DEBUG_PREFIX + 'raw transcript:', userMessageRaw);

            // Detect trigger words
            let messageStart = -1;

            if (extension_settings.speech_recognition.Streaming.triggerWordsEnabled) {

                for (const triggerWord of extension_settings.speech_recognition.Streaming.triggerWords) {
                    const triggerPos = userMessageRaw.indexOf(triggerWord.toLowerCase());

                    // Trigger word not found or not starting message and just a substring
                    if (triggerPos == -1) { // | (triggerPos > 0 & userMessageFormatted[triggerPos-1] != " ")) {
                        console.debug(DEBUG_PREFIX + 'trigger word not found: ', triggerWord);
                    }
                    else {
                        console.debug(DEBUG_PREFIX + 'Found trigger word: ', triggerWord, ' at index ', triggerPos);
                        if (triggerPos < messageStart || messageStart == -1) { // & (triggerPos + triggerWord.length) < userMessageFormatted.length)) {
                            messageStart = triggerPos; // + triggerWord.length + 1;

                            if (!extension_settings.speech_recognition.Streaming.triggerWordsIncluded)
                                messageStart = triggerPos + triggerWord.length + 1;
                        }
                    }
                }
            } else {
                messageStart = 0;
            }

            if (messageStart == -1) {
                console.debug(DEBUG_PREFIX + 'message ignored, no trigger word preceding a message. Voice transcript: "' + userMessageOriginal + '"');
                if (extension_settings.speech_recognition.Streaming.debug) {
                    toastr.info(
                        'No trigger word preceding a message. Voice transcript: "' + userMessageOriginal + '"',
                        DEBUG_PREFIX + 'message ignored.',
                        { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true },
                    );
                }
            }
            else {
                userMessageFormatted = userMessageFormatted.substring(messageStart);
                // Trim non alphanumeric character from the start
                messageStart = 0;
                for (const i of userMessageFormatted) {
                    if (/^[a-z]$/i.test(i)) {
                        break;
                    }
                    messageStart += 1;
                }
                userMessageFormatted = userMessageFormatted.substring(messageStart);
                userMessageFormatted = userMessageFormatted.charAt(0).toUpperCase() + userMessageFormatted.substring(1);
                processTranscript(userMessageFormatted);
            }
        }
        else {
            console.debug(DEBUG_PREFIX + 'Received empty transcript, ignored');
        }
    }
    catch (error) {
        console.debug(error);
    }
    finally {
        inApiCall = false;
    }
}

async function processTranscript(transcript) {
    try {
        const transcriptOriginal = transcript;
        let transcriptFormatted = transcriptOriginal.trim();

        if (transcriptFormatted.length > 0) {
            console.debug(DEBUG_PREFIX + 'recorded transcript: "' + transcriptFormatted + '"');
            const messageMode = extension_settings.speech_recognition.messageMode;
            console.debug(DEBUG_PREFIX + 'mode: ' + messageMode);

            let transcriptLower = transcriptFormatted.toLowerCase();
            // remove punctuation
            let transcriptRaw = transcriptLower.replace(/[^\w\s\']|_/g, '').replace(/\s+/g, ' ');

            // Check message mapping
            if (extension_settings.speech_recognition.messageMappingEnabled) {
                console.debug(DEBUG_PREFIX + 'Start searching message mapping into:', transcriptRaw);
                for (const key in extension_settings.speech_recognition.messageMapping) {
                    console.debug(DEBUG_PREFIX + 'message mapping searching: ', key, '=>', extension_settings.speech_recognition.messageMapping[key]);
                    if (transcriptRaw.includes(key)) {
                        var message = extension_settings.speech_recognition.messageMapping[key];
                        console.debug(DEBUG_PREFIX + 'message mapping found: ', key, '=>', extension_settings.speech_recognition.messageMapping[key]);
                        $('#send_textarea').val(message);

                        if (messageMode == 'auto_send') await getContext().generate();
                        return;
                    }
                }
            }

            console.debug(DEBUG_PREFIX + 'no message mapping found, processing transcript as normal message');
            const textarea = $('#send_textarea');

            switch (messageMode) {
                case 'auto_send':
                    // clear message area to avoid double message
                    textarea.val('')[0].dispatchEvent(new Event('input', { bubbles: true }));

                    await sendMessageAsUser(transcriptFormatted);
                    await getContext().generate();

                    $('#debug_output').text('<SST-module DEBUG>: message sent: "' + transcriptFormatted + '"');
                    break;

                case 'replace':
                    console.debug(DEBUG_PREFIX + 'Replacing message');
                    textarea.val(transcriptFormatted);
                    break;

                case 'append':
                    console.debug(DEBUG_PREFIX + 'Appending message');
                    const existingMessage = textarea.val();
                    textarea.val(existingMessage + ' ' + transcriptFormatted);
                    break;

                default:
                    console.debug(DEBUG_PREFIX + 'Not supported stt message mode: ' + messageMode);

            }
        }
        else {
            console.debug(DEBUG_PREFIX + 'Empty transcript, do nothing');
        }
    }
    catch (error) {
        console.debug(error);
    }
}

function loadNavigatorAudioRecording() {
    if (navigator.mediaDevices.getUserMedia) {
        console.debug(DEBUG_PREFIX + ' getUserMedia supported by browser.');
        const micButton = $('#microphone_button');

        let onSuccess = function (stream) {
            const audioContext = new AudioContext({ sampleRate: 16000 });
            const source = audioContext.createMediaStreamSource(stream);
            const settings = {
                source: source,
                voice_start: function () {
                    if (!audioRecording && extension_settings.speech_recognition.voiceActivationEnabled) {
                        console.debug(DEBUG_PREFIX + 'Voice started');
                        if (micButton.is(':visible')) {
                            micButton.trigger('click');
                        }
                    }
                },
                voice_stop: function () {
                    if (audioRecording && extension_settings.speech_recognition.voiceActivationEnabled) {
                        console.debug(DEBUG_PREFIX + 'Voice stopped');
                        if (micButton.is(':visible')) {
                            micButton.trigger('click');
                        }
                    }
                },
            };

            new VAD(settings);

            const mediaRecorder = new MediaRecorder(stream);

            micButton.off('click').on('click', function () {
                if (!audioRecording) {
                    mediaRecorder.start();
                    console.debug(mediaRecorder.state);
                    console.debug('recorder started');
                    audioRecording = true;
                    micButton.toggleClass('fa-microphone fa-microphone-slash');
                }
                else {
                    mediaRecorder.stop();
                    console.debug(mediaRecorder.state);
                    console.debug('recorder stopped');
                    audioRecording = false;
                    micButton.toggleClass('fa-microphone fa-microphone-slash');
                }
            });

            mediaRecorder.onstop = async function () {
                console.debug(DEBUG_PREFIX + 'data available after MediaRecorder.stop() called: ', audioChunks.length, ' chunks');
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
                const arrayBuffer = await audioBlob.arrayBuffer();

                // Use AudioContext to decode our array buffer into an audio buffer
                const audioContext = new AudioContext();
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                audioChunks = [];

                const wavBlob = await convertAudioBufferToWavBlob(audioBuffer);
                const transcript = await sttProvider.processAudio(wavBlob);

                // TODO: lock and release recording while processing?
                console.debug(DEBUG_PREFIX + 'received transcript:', transcript);
                processTranscript(transcript);
            };

            mediaRecorder.ondataavailable = function (e) {
                audioChunks.push(e.data);
            };
        };

        let onError = function (err) {
            console.debug(DEBUG_PREFIX + 'The following error occured: ' + err);
        };

        navigator.mediaDevices.getUserMedia(constraints).then(onSuccess, onError);

    } else {
        console.debug(DEBUG_PREFIX + 'getUserMedia not supported on your browser!');
        toastr.error('getUserMedia not supported', DEBUG_PREFIX + 'not supported for your browser.', { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
    }
}

//##############//
// STT Provider //
//##############//

function loadSttProvider(provider) {
    //Clear the current config and add new config
    $('#speech_recognition_provider_settings').html('');

    // Init provider references
    extension_settings.speech_recognition.currentProvider = provider;
    sttProviderName = provider;

    if (!(sttProviderName in extension_settings.speech_recognition)) {
        console.warn(`Provider ${sttProviderName} not in Extension Settings, initiatilizing provider in settings`);
        extension_settings.speech_recognition[sttProviderName] = {};
    }

    $('#speech_recognition_provider').val(sttProviderName);

    if (sttProviderName == 'None') {
        $('#microphone_button').hide();
        $('#speech_recognition_message_mode_div').hide();
        $('#speech_recognition_message_mapping_div').hide();
        $('#speech_recognition_language_div').hide();
        $('#speech_recognition_ptt_div').hide();
        $('#speech_recognition_voice_activation_enabled_div').hide();
        return;
    }

    $('#speech_recognition_message_mode_div').show();
    $('#speech_recognition_message_mapping_div').show();
    $('#speech_recognition_language_div').show();

    sttProvider = new sttProviders[sttProviderName];

    // Init provider settings
    $('#speech_recognition_provider_settings').append(sttProvider.settingsHtml);

    // Use microphone button as push to talk
    if (sttProviderName == 'Browser') {
        $('#speech_recognition_language_div').hide();
        sttProvider.processTranscriptFunction = processTranscript;
        sttProvider.loadSettings(extension_settings.speech_recognition[sttProviderName]);
        $('#microphone_button').show();
    }

    if (sttProviderName == 'Vosk' || sttProviderName == 'Whisper (OpenAI)' || sttProviderName == 'Whisper (Extras)' || sttProviderName == 'Whisper (Local)') {
        sttProvider.loadSettings(extension_settings.speech_recognition[sttProviderName]);
        loadNavigatorAudioRecording();
        $('#microphone_button').show();
    }

    if (sttProviderName == 'Streaming') {
        sttProvider.loadSettings(extension_settings.speech_recognition[sttProviderName]);
        $('#microphone_button').off('click');
        $('#microphone_button').hide();
    }

    $('#speech_recognition_ptt_div').toggle(sttProviderName != 'Streaming');
    $('#speech_recognition_voice_activation_enabled_div').toggle(sttProviderName != 'Streaming');
}

function onSttLanguageChange() {
    extension_settings.speech_recognition[sttProviderName].language = String($('#speech_recognition_language').val());
    sttProvider.loadSettings(extension_settings.speech_recognition[sttProviderName]);
    saveSettingsDebounced();
}

function onSttProviderChange() {
    const sttProviderSelection = $('#speech_recognition_provider').val();
    loadSttProvider(sttProviderSelection);
    saveSettingsDebounced();
}

function onSttProviderSettingsInput() {
    sttProvider.onSettingsChange();

    // Persist changes to SillyTavern stt extension settings
    extension_settings.speech_recognition[sttProviderName] = sttProvider.settings;
    saveSettingsDebounced();
    console.info(`Saved settings ${sttProviderName} ${JSON.stringify(sttProvider.settings)}`);
}

//#############################//
//  Extension UI and Settings  //
//#############################//

const defaultSettings = {
    currentProvider: 'None',
    messageMode: 'append',
    messageMappingText: '',
    messageMapping: [],
    messageMappingEnabled: false,
    voiceActivationEnabled: false,
    /**
     * @type {KeyCombo} Push-to-talk key combo
     */
    ptt: null,
};

function loadSettings() {
    if (Object.keys(extension_settings.speech_recognition).length === 0) {
        Object.assign(extension_settings.speech_recognition, defaultSettings);
    }
    for (const key in defaultSettings) {
        if (extension_settings.speech_recognition[key] === undefined) {
            extension_settings.speech_recognition[key] = defaultSettings[key];
        }
    }
    $('#speech_recognition_enabled').prop('checked', extension_settings.speech_recognition.enabled);
    $('#speech_recognition_message_mode').val(extension_settings.speech_recognition.messageMode);

    if (extension_settings.speech_recognition.messageMappingText.length > 0) {
        $('#speech_recognition_message_mapping').val(extension_settings.speech_recognition.messageMappingText);
    }

    $('#speech_recognition_message_mapping_enabled').prop('checked', extension_settings.speech_recognition.messageMappingEnabled);
    $('#speech_recognition_ptt').val(extension_settings.speech_recognition.ptt ? formatPushToTalkKey(extension_settings.speech_recognition.ptt) : '');
    $('#speech_recognition_voice_activation_enabled').prop('checked', extension_settings.speech_recognition.voiceActivationEnabled);
}

async function onMessageModeChange() {
    extension_settings.speech_recognition.messageMode = $('#speech_recognition_message_mode').val();

    if (sttProviderName != 'Browser' && extension_settings.speech_recognition.messageMode == 'auto_send') {
        $('#speech_recognition_wait_response_div').show();
    }
    else {
        $('#speech_recognition_wait_response_div').hide();
    }

    saveSettingsDebounced();
}

async function onMessageMappingChange() {
    let array = String($('#speech_recognition_message_mapping').val()).split(',');
    array = array.map(element => { return element.trim(); });
    array = array.filter((str) => str !== '');
    extension_settings.speech_recognition.messageMapping = {};
    for (const text of array) {
        if (text.includes('=')) {
            const pair = text.toLowerCase().split('=');
            extension_settings.speech_recognition.messageMapping[pair[0].trim()] = pair[1].trim();
            console.debug(DEBUG_PREFIX + 'Added mapping', pair[0], '=>', extension_settings.speech_recognition.messageMapping[pair[0]]);
        }
        else {
            console.debug(DEBUG_PREFIX + 'Wrong syntax for message mapping, no \'=\' found in:', text);
        }
    }

    $('#speech_recognition_message_mapping_status').text('Message mapping updated to: ' + JSON.stringify(extension_settings.speech_recognition.messageMapping));
    console.debug(DEBUG_PREFIX + 'Updated message mapping', extension_settings.speech_recognition.messageMapping);
    extension_settings.speech_recognition.messageMappingText = $('#speech_recognition_message_mapping').val();
    saveSettingsDebounced();
}

async function onMessageMappingEnabledClick() {
    extension_settings.speech_recognition.messageMappingEnabled = $('#speech_recognition_message_mapping_enabled').is(':checked');
    saveSettingsDebounced();
}

function onVoiceActivationEnabledChange() {
    extension_settings.speech_recognition.voiceActivationEnabled = !!$('#speech_recognition_voice_activation_enabled').prop('checked');
    saveSettingsDebounced();
}

async function convertAudioBufferToWavBlob(audioBuffer) {
    return new Promise(function (resolve) {
        var worker = new Worker('/scripts/extensions/third-party/Extension-Speech-Recognition/wave-worker.js');

        worker.onmessage = function (e) {
            var blob = new Blob([e.data.buffer], { type: 'audio/wav' });
            resolve(blob);
        };

        let pcmArrays = [];
        for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
            pcmArrays.push(audioBuffer.getChannelData(i));
        }

        worker.postMessage({
            pcmArrays,
            config: { sampleRate: audioBuffer.sampleRate },
        });
    });
}

/**
 * @typedef {object} KeyCombo
 * @property {string} key
 * @property {boolean} ctrl
 * @property {boolean} alt
 * @property {boolean} shift
 * @property {boolean} meta
 */

/**
 * Convert a native keyboard event to a key combo object.
 * @param {KeyboardEvent} event Native keyboard event
 * @returns {KeyCombo} Key combo object
 */
function keyboardEventToKeyCombo(event) {
    return {
        code: event.code,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        meta: event.metaKey,
    };
}

/**
 * Key labels for Windows.
 * @type {Record<string, string>}
 */
const WINDOWS_LABELS = {
    ctrl: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
    meta: 'Win',
};

/**
 * Key labels for macOS.
 * @type {Record<string, string>}
 */
const MAC_LABELS = {
    ctrl: '⌃',
    alt: '⌥',
    shift: '⇧',
    meta: '⌘',
};

/**
 * Key labels for Linux.
 * @type {Record<string, string>}
 */
const LINUX_LABELS = {
    ctrl: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
    meta: 'Meta',
};

/**
 * Gets the key labels for the current user agent.
 * @returns {Record<string, string>}
 */
function getLabelsForUserAgent() {
    const userAgent = navigator.userAgent;
    if (userAgent.includes('Macintosh')) {
        return MAC_LABELS;
    } else if (userAgent.includes('Windows')) {
        return WINDOWS_LABELS;
    } else {
        return LINUX_LABELS;
    }
}

/**
 * Format a key combo object as a string.
 * @param {KeyCombo} key Key combo object
 * @returns {string} String representation of the key combo
 */
function formatPushToTalkKey(key) {
    const labels = getLabelsForUserAgent();
    const parts = [];
    if (key.ctrl) {
        parts.push(labels.ctrl);
    }
    if (key.alt) {
        parts.push(labels.alt);
    }
    if (key.shift) {
        parts.push(labels.shift);
    }
    if (key.meta) {
        parts.push(labels.meta);
    }
    parts.push(key.code);
    return parts.join(' + ');
}

/**
 * Check if a key combo object matches a keyboard event.
 * @param {KeyCombo} keyCombo Key combo object
 * @param {KeyboardEvent} event Original event
 * @returns
 */
function isKeyComboMatch(keyCombo, event) {
    return keyCombo.code === event.code
        && keyCombo.ctrl === event.ctrlKey
        && keyCombo.alt === event.altKey
        && keyCombo.shift === event.shiftKey
        && keyCombo.meta === event.metaKey;
}

/**
 * Check if push-to-talk is enabled.
 * @returns {boolean} True if push-to-talk is enabled
 */
function isPushToTalkEnabled() {
    return extension_settings.speech_recognition.ptt !== null && sttProviderName !== 'Streaming' && sttProviderName !== 'None';
}

let lastPressTime = 0;

/**
 * Event handler for push-to-talk start.
 * @param {KeyboardEvent} event Event
 */
function processPushToTalkStart(event) {
    // Push-to-talk not enabled
    if (!isPushToTalkEnabled()) {
        return;
    }

    const key = extension_settings.speech_recognition.ptt;

    // Key combo match - toggle recording
    if (isKeyComboMatch(key, event) && !event.repeat) {
        console.debug(DEBUG_PREFIX + 'Push-to-talk key pressed');
        lastPressTime = Date.now();
        $('#microphone_button').trigger('click');
    }
}

/**
 * Event handler for push-to-talk end.
 * @param {KeyboardEvent} event Event
 */
function processPushToTalkEnd(event) {
    // Push-to-talk not enabled
    if (!isPushToTalkEnabled()) {
        return;
    }

    /** @type {KeyCombo} */
    const key = extension_settings.speech_recognition.ptt;

    // Key combo match (without modifier keys)
    if (key.code === event.code) {
        console.debug(DEBUG_PREFIX + 'Push-to-talk key released');

        // If the key was held for more than 500ms and still recording, stop recording
        if (Date.now() - lastPressTime > 500 && audioRecording) {
            $('#microphone_button').trigger('click');
        }
    }
}

$(document).ready(function () {
    function addExtensionControls() {
        const settingsHtml = `
        <div id="speech_recognition_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Speech Recognition</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div>
                        <span>Select Speech-to-text Provider</span> </br>
                        <select id="speech_recognition_provider">
                        </select>
                    </div>
                    <div id="speech_recognition_language_div">
                        <span>Speech Language</span> </br>
                        <select id="speech_recognition_language">
                            <option value="">-- Automatic --</option>
                            <option value="af">Afrikaans</option>
                            <option value="ar">Arabic</option>
                            <option value="hy">Armenian</option>
                            <option value="az">Azerbaijani</option>
                            <option value="be">Belarusian</option>
                            <option value="bs">Bosnian</option>
                            <option value="bg">Bulgarian</option>
                            <option value="ca">Catalan</option>
                            <option value="zh">Chinese</option>
                            <option value="hr">Croatian</option>
                            <option value="cs">Czech</option>
                            <option value="da">Danish</option>
                            <option value="nl">Dutch</option>
                            <option value="en">English</option>
                            <option value="et">Estonian</option>
                            <option value="fi">Finnish</option>
                            <option value="fr">French</option>
                            <option value="gl">Galician</option>
                            <option value="de">German</option>
                            <option value="el">Greek</option>
                            <option value="he">Hebrew</option>
                            <option value="hi">Hindi</option>
                            <option value="hu">Hungarian</option>
                            <option value="is">Icelandic</option>
                            <option value="id">Indonesian</option>
                            <option value="it">Italian</option>
                            <option value="ja">Japanese</option>
                            <option value="kn">Kannada</option>
                            <option value="kk">Kazakh</option>
                            <option value="ko">Korean</option>
                            <option value="lv">Latvian</option>
                            <option value="lt">Lithuanian</option>
                            <option value="mk">Macedonian</option>
                            <option value="ms">Malay</option>
                            <option value="mr">Marathi</option>
                            <option value="mi">Maori</option>
                            <option value="ne">Nepali</option>
                            <option value="no">Norwegian</option>
                            <option value="fa">Persian</option>
                            <option value="pl">Polish</option>
                            <option value="pt">Portuguese</option>
                            <option value="ro">Romanian</option>
                            <option value="ru">Russian</option>
                            <option value="sr">Serbian</option>
                            <option value="sk">Slovak</option>
                            <option value="sl">Slovenian</option>
                            <option value="es">Spanish</option>
                            <option value="sw">Swahili</option>
                            <option value="sv">Swedish</option>
                            <option value="tl">Tagalog</option>
                            <option value="ta">Tamil</option>
                            <option value="th">Thai</option>
                            <option value="tr">Turkish</option>
                            <option value="uk">Ukrainian</option>
                            <option value="ur">Urdu</option>
                            <option value="vi">Vietnamese</option>
                            <option value="cy">Welsh</option>
                        </select>
                    </div>
                    <div id="speech_recognition_ptt_div">
                        <span>Recording Hotkey</span>
                        <i title="Press the designated keystroke to start the recording. Press again to stop. Only works if a browser tab is in focus." class="fa-solid fa-info-circle opacity50p"></i>
                        <input readonly type="text" id="speech_recognition_ptt" class="text_pole" placeholder="Click to set push-to-talk key">
                    </div>
                    <div id="speech_recognition_voice_activation_enabled_div" title="Automatically start and stop recording when you start and stop speaking.">
                        <label class="checkbox_label" for="speech_recognition_voice_activation_enabled">
                            <input type="checkbox" id="speech_recognition_voice_activation_enabled" name="speech_recognition_voice_activation_enabled">
                            <small>Enable activation by voice</small>
                        </label>
                    </div>
                    <div id="speech_recognition_message_mode_div">
                        <span>Message Mode</span> </br>
                        <select id="speech_recognition_message_mode">
                            <option value="append">Append</option>
                            <option value="replace">Replace</option>
                            <option value="auto_send">Auto send</option>
                        </select>
                    </div>
                    <div id="speech_recognition_message_mapping_div">
                        <span>Message Mapping</span>
                        <textarea id="speech_recognition_message_mapping" class="text_pole textarea_compact" type="text" rows="4" placeholder="Enter comma separated phrases mapping, example:\ncommand delete = /del 2,\nslash delete = /del 2,\nsystem roll = /roll 2d6,\nhey continue = /continue"></textarea>
                        <span id="speech_recognition_message_mapping_status"></span>
                        <label class="checkbox_label" for="speech_recognition_message_mapping_enabled">
                            <input type="checkbox" id="speech_recognition_message_mapping_enabled" name="speech_recognition_message_mapping_enabled">
                            <small>Enable messages mapping</small>
                        </label>
                    </div>
                    <form id="speech_recognition_provider_settings" class="inline-drawer-content">
                    </form>
                </div>
            </div>
        </div>
        `;
        $('#extensions_settings').append(settingsHtml);
        $('#speech_recognition_provider_settings').on('input', onSttProviderSettingsInput);
        for (const provider in sttProviders) {
            $('#speech_recognition_provider').append($('<option />').val(provider).text(provider));
            console.debug(DEBUG_PREFIX + 'added option ' + provider);
        }
        $('#speech_recognition_provider').on('change', onSttProviderChange);
        $('#speech_recognition_message_mode').on('change', onMessageModeChange);
        $('#speech_recognition_message_mapping').on('change', onMessageMappingChange);
        $('#speech_recognition_language').on('change', onSttLanguageChange);
        $('#speech_recognition_message_mapping_enabled').on('click', onMessageMappingEnabledClick);
        $('#speech_recognition_voice_activation_enabled').on('change', onVoiceActivationEnabledChange);
        $('#speech_recognition_ptt').on('focus', function () {
            if (this instanceof HTMLInputElement) {
                this.value = 'Enter a key combo. "Escape" to clear';
                $(this).off('keydown').on('keydown', function (e) {
                    e.preventDefault();
                    e.stopPropagation();

                    if (e.key === 'Meta' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Control') {
                        return;
                    }

                    if (e.key === 'Escape') {
                        extension_settings.speech_recognition.ptt = null;
                        saveSettingsDebounced();
                        return this.blur();
                    }

                    const keyCombo = keyboardEventToKeyCombo(e);
                    extension_settings.speech_recognition.ptt = keyCombo;
                    saveSettingsDebounced();
                    return this.blur();
                });
            }
        });
        $('#speech_recognition_ptt').on('blur', function () {
            if (this instanceof HTMLInputElement) {
                $(this).off('keydown');
                if (extension_settings.speech_recognition.ptt) {
                    this.value = formatPushToTalkKey(extension_settings.speech_recognition.ptt);
                } else {
                    this.value = '';
                }
            }
        });

        document.body.addEventListener('keydown', processPushToTalkStart);
        document.body.addEventListener('keyup', processPushToTalkEnd);

        const $button = $('<div id="microphone_button" class="fa-solid fa-microphone speech-toggle" title="Click to speak"></div>');
        // For versions before 1.10.10
        if ($('#send_but_sheld').length == 0) {
            $('#rightSendForm').prepend($button);
        } else {
            $('#send_but_sheld').prepend($button);
        }

    }
    addExtensionControls(); // No init dependencies
    loadSettings(); // Depends on Extension Controls and loadTtsProvider
    loadSttProvider(extension_settings.speech_recognition.currentProvider); // No dependencies
    const wrapper = new ModuleWorkerWrapper(moduleWorker);
    setInterval(wrapper.update.bind(wrapper), UPDATE_INTERVAL); // Init depends on all the things
    moduleWorker();
});
