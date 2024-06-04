import { textgenerationwebui_settings, textgen_types } from '../../../textgen-settings.js';
import { getRequestHeaders } from '../../../../script.js';
export { KoboldCppSttProvider };

const DEBUG_PREFIX = '<Speech Recognition module (KoboldCpp)> ';

class KoboldCppSttProvider {
    //########//
    // Config //
    //########//

    settings;

    defaultSettings = {
        language: '',
    };

    get settingsHtml() {
        let html = '<div>Requires KoboldCpp 1.67 or later. See the <a href="https://github.com/LostRuins/koboldcpp/releases/tag/v1.67" target="_blank">release notes</a> for more information.</div>';
        html += '<div><i>Hint: Set KoboldCpp URL in the API connection settings (under Text Completion!)</i></div>';
        return html;
    }

    onSettingsChange() {
        // Used when provider settings are updated from UI
    }

    loadSettings(settings) {
        // Populate Provider UI given input settings
        if (Object.keys(settings).length == 0) {
            console.debug(DEBUG_PREFIX + 'Using default KoboldCpp STT extension settings');
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
        console.debug(DEBUG_PREFIX + 'KoboldCpp STT settings loaded');
    }

    async processAudio(audioBlob) {
        const server = textgenerationwebui_settings.server_urls[textgen_types.KOBOLDCPP];

        if (!server) {
            toastr.error('KoboldCpp server URL is not set.',);
            throw new Error('KoboldCpp server URL is not set.');
        }

        const requestData = new FormData();
        requestData.append('avatar', audioBlob, 'record.wav');
        requestData.append('language', this.settings.language);
        requestData.append('server', server);

        // It's not a JSON, let fetch set the content type
        const headers = getRequestHeaders();
        delete headers['Content-Type'];

        const apiResult = await fetch('/api/backends/kobold/transcribe-audio', {
            method: 'POST',
            headers: headers,
            body: requestData,
        });

        if (!apiResult.ok) {
            toastr.error(apiResult.statusText, 'STT Generation Failed  (KoboldCpp)', { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
            throw new Error(`HTTP ${apiResult.status}: ${await apiResult.text()}`);
        }

        const result = await apiResult.json();
        return result.text;
    }
}
