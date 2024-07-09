import { getRequestHeaders } from '../../../../script.js';
import { getBase64Async } from '../../../utils.js';
export { WhisperLocalSttProvider };

const DEBUG_PREFIX = '<Speech Recognition module (Whisper Local)> ';

class WhisperLocalSttProvider {
    settings;

    defaultSettings = {
        language: '',
        model: 'Xenova/whisper-base.en',
    };

    get settingsHtml() {
        let html = `
        <span>Whisper Model</span> </br>
        <select id="whisper_local_model">
            <optgroup label="Multilingual">
                <option value="Xenova/whisper-tiny">whisper-tiny</option>
                <option value="Xenova/whisper-base">whisper-base</option>
                <option value="Xenova/whisper-small">whisper-small</option>
                <option value="Xenova/whisper-medium">whisper-medium</option>
                <option value="Xenova/whisper-large">whisper-large</option>
                <option value="Xenova/whisper-large-v2">whisper-large-v2</option>
                <option value="Xenova/whisper-large-v3">whisper-large-v3</option>
            </optgroup>
            <optgroup label="English">
                <option value="Xenova/whisper-tiny.en">whisper-tiny.en</option>
                <option value="Xenova/whisper-base.en">whisper-base.en</option>
                <option value="Xenova/whisper-small.en">whisper-small.en</option>
                <option value="Xenova/whisper-medium.en">whisper-medium.en</option>
            </optgroup>
        </select>
        <div><i>Loading model for the first time may take a while!</i></div>`;
        return html;
    }

    onSettingsChange() {
        // Used when provider settings are updated from UI
        this.settings.model = $('#whisper_local_model').val();
        console.debug(DEBUG_PREFIX + ' Updated settings: ', this.settings);
        this.loadSettings(this.settings);
    }

    loadSettings(settings) {
        // Populate Provider UI given input settings
        if (Object.keys(settings).length == 0) {
            console.debug(DEBUG_PREFIX + 'Using default Whisper (Local) STT extension settings');
        }

        // Only accept keys defined in defaultSettings
        this.settings = this.defaultSettings;

        for (const key in settings) {
            if (key in this.settings) {
                this.settings[key] = settings[key];
            } else {
                throw `Invalid setting passed to STT extension: ${key}`;
            }
        }

        $('#speech_recognition_language').val(this.settings.language);
        $('#whisper_local_model').val(this.settings.model);
        console.debug(DEBUG_PREFIX + 'Whisper (Local) STT settings loaded');
    }

    async processAudio(audioBlob) {
        const audio = await getBase64Async(audioBlob);
        const lang = this.settings.language || null;
        const model = this.settings.model || 'Xenova/whisper-base.en';

        // It's not a JSON, let fetch set the content type

        const apiResult = await fetch('/api/speech/recognize', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ audio, lang, model }),
        });

        if (!apiResult.ok) {
            toastr.error(apiResult.statusText, 'STT Generation Failed (Whisper Local)', { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
            throw new Error(`HTTP ${apiResult.status}: ${await apiResult.text()}`);
        }

        const result = await apiResult.json();
        return result.text;
    }
}
