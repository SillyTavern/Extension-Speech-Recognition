import { getApiUrl, doExtrasFetch } from '../../../extensions.js';
export { WhisperExtrasSttProvider };

const DEBUG_PREFIX = '<Speech Recognition module (Whisper Extras)> ';

class WhisperExtrasSttProvider {
    //########//
    // Config //
    //########//

    settings;

    defaultSettings = {
        //model_path: "",
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
            console.debug(DEBUG_PREFIX + 'Using default Whisper STT extension settings');
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
        console.debug(DEBUG_PREFIX + 'Whisper (Extras) STT settings loaded');
    }

    async processAudio(audioblob) {
        var requestData = new FormData();
        requestData.append('AudioFile', audioblob, 'record.wav');
        requestData.append('language', this.settings.language);

        const url = new URL(getApiUrl());
        url.pathname = '/api/speech-recognition/whisper/process-audio';

        const apiResult = await doExtrasFetch(url, {
            method: 'POST',
            body: requestData,
        });

        if (!apiResult.ok) {
            toastr.error(apiResult.statusText, 'STT Generation Failed (Whisper Extras)', { timeOut: 10000, extendedTimeOut: 20000, preventDuplicates: true });
            throw new Error(`HTTP ${apiResult.status}: ${await apiResult.text()}`);
        }

        const result = await apiResult.json();
        return result.transcript;
    }

}
