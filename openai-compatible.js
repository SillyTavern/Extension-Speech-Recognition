import { getRequestHeaders } from '../../../../script.js';
export { OpenAICompatibleSttProvider };

const DEBUG_PREFIX = '<Speech Recognition module (OpenAI Compatible)> ';

class OpenAICompatibleSttProvider {
    settings;

    defaultSettings = {
        language: '',
        model: 'whisper-1',
        provider_endpoint: 'http://127.0.0.1:8005/v1/audio/transcriptions',
        api_key: '',
    };

    get settingsHtml() {
        let html = `
        <label for="openai_compatible_stt_endpoint">Provider Endpoint:</label>
        <input id="openai_compatible_stt_endpoint" type="text" class="text_pole" maxlength="500" value="${this.defaultSettings.provider_endpoint}"/>
        <label for="openai_compatible_stt_model">Model:</label>
        <input id="openai_compatible_stt_model" type="text" class="text_pole" maxlength="500" value="${this.defaultSettings.model}"/>
        <label for="openai_compatible_stt_key">API Key (optional, only if your server requires one):</label>
        <input id="openai_compatible_stt_key" type="password" class="text_pole" maxlength="500" value=""/>
        `;
        return html;
    }

    onSettingsChange() {
        // Used when provider settings are updated from UI
        this.settings.provider_endpoint = String($('#openai_compatible_stt_endpoint').val());
        this.settings.model = String($('#openai_compatible_stt_model').val());
        this.settings.api_key = String($('#openai_compatible_stt_key').val());
        console.debug(DEBUG_PREFIX + ' Updated settings: ', this.settings);
        this.loadSettings(this.settings);
    }

    loadSettings(settings) {
        // Populate Provider UI given input settings
        if (Object.keys(settings).length == 0) {
            console.debug(DEBUG_PREFIX + 'Using default OpenAI Compatible STT extension settings');
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
        $('#openai_compatible_stt_endpoint').val(this.settings.provider_endpoint);
        $('#openai_compatible_stt_model').val(this.settings.model);
        $('#openai_compatible_stt_key').val(this.settings.api_key);
        console.debug(DEBUG_PREFIX + 'OpenAI Compatible STT settings loaded');
    }

    async processAudio(audioBlob) {
        const requestData = new FormData();
        requestData.append('avatar', audioBlob, 'record.wav');
        requestData.append('provider_endpoint', this.settings.provider_endpoint);
        requestData.append('model', this.settings.model || this.defaultSettings.model);

        if (this.settings.language) {
            requestData.append('language', this.settings.language);
        }

        if (this.settings.api_key) {
            requestData.append('api_key', this.settings.api_key);
        }

        const apiResult = await fetch('/api/openai/custom/transcribe-audio', {
            method: 'POST',
            headers: getRequestHeaders({ omitContentType: true }),
            body: requestData,
        });

        if (!apiResult.ok) {
            toastr.error(apiResult.statusText, 'STT Generation Failed (OpenAI Compatible)', { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
            throw new Error(`HTTP ${apiResult.status}: ${await apiResult.text()}`);
        }

        const result = await apiResult.json();
        return result.text;
    }
}
