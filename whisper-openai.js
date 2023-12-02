import { getRequestHeaders } from '../../../../script.js';
export { WhisperOpenAISttProvider };

const DEBUG_PREFIX = '<Speech Recognition module (Whisper OpenAI)> ';

class WhisperOpenAISttProvider {
    settings;

    defaultSettings = {
        language: '',
    };

    get settingsHtml() {
        let html = '';
        return html;
    }

    onSettingsChange() {
        // Used when provider settings are updated from UI
    }

    loadSettings(settings) {
        // Populate Provider UI given input settings
        if (Object.keys(settings).length == 0) {
            console.debug(DEBUG_PREFIX + 'Using default Whisper (OpenAI) STT extension settings');
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
        console.debug(DEBUG_PREFIX + 'Whisper (OpenAI) STT settings loaded');
    }

    async processAudio(audioBlob) {
        const requestData = new FormData();
        requestData.append('avatar', audioBlob, 'record.wav');

        // TODO: Add model selection to settings when more models are available
        requestData.append('model', 'whisper-1');

        if (this.settings.language) {
            requestData.append('language', this.settings.language);
        }

        // It's not a JSON, let fetch set the content type
        const headers = getRequestHeaders();
        delete headers['Content-Type'];

        const apiResult = await fetch('/api/openai/transcribe-audio', {
            method: 'POST',
            headers: headers,
            body: requestData,
        });

        if (!apiResult.ok) {
            toastr.error(apiResult.statusText, 'STT Generation Failed (Whisper OpenAI)', { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
            throw new Error(`HTTP ${apiResult.status}: ${await apiResult.text()}`);
        }

        const result = await apiResult.json();
        return result.text;
    }

}
