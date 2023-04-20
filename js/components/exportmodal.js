// TODO: Make more modular by utilzing Web Component functionality
class ExportModal extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
        <div class="modal" id="export-modal">
            <div class="modal-background" onclick="hideExportModal()"></div>
            <div class="modal-content is-large">
                <div class="is-pulled-right">
                    <button class="delete is-close-button is-large" onclick="hideExportModal()"></button>
                </div>
                <div class="box">
                    <div class="notification is-link is-light">
                        <h1 class="title is-4" i18n="export-data"></h1>
                        <p class="mb-5" i18n="export-data-hint"></p>
                        <div class="buttons are-small">
                            <button class="button is-link is-flex-grow-1" onclick="exportODM()" i18n="export-project"></button>
                            <button class="button is-flex-grow-1" onclick="exportODMMetadata()" i18n="export-metadata"></button>
                            <button class="button is-flex-grow-1" onclick="exportCSV()" i18n="export-clinicaldata"></button>
                            <button class="button is-flex-grow-1" onclick="exportCSVZip()" i18n="export-clinicaldata-zip"></button>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
    }
}

window.customElements.define("export-modal", ExportModal);
