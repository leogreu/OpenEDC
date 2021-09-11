import ODMPath from "./odmwrapper/odmpath.js";
import * as reportsHelper from "./helper/reportshelper.js";
import * as metadataWrapper from "./odmwrapper/metadatawrapper.js";
import * as clinicaldataWrapper from "./odmwrapper/clinicaldatawrapper.js";
import * as admindataWrapper from "./odmwrapper/admindatawrapper.js";
import * as languageHelper from "./helper/languagehelper.js";
import * as ioHelper from "./helper/iohelper.js";

// Import custom charts
import { CustomBarChart } from "./charts/custombarchart.js";
import { CustomScatterChart } from "./charts/customscatterchart.js";

const $ = query => document.querySelector(query);
const $$ = query => document.querySelectorAll(query);

let dataset = {};
let currentReport = null;
let widgetComponents = [];
let activeFilters = [];

export async function init() {
    // TODO: Do not init within startApp() but only when needed

    // Only load chart.js library if required
    await import("./components/reports/widgetcomponent.js");
    await import("./components/reports/widgetcontent.js");
    await import("./components/reports/widgetoptions.js");
    await import("../lib/chart.js");
    await import("../lib/chart-datalabels.js");
    
    await reportsHelper.init();

    setIOListeners();
}

export async function show() {
    if (!currentReport) {
        $("#reports-section h1").textContent = languageHelper.getTranslation("no-reported-selected-hint");
        $("#reports-section h2").textContent = languageHelper.getTranslation("please-select-record-hint");
    }

    loadReportList();
    languageHelper.createLanguageSelect();

    // Load data
    const showLoadingIndicator = ioHelper.hasServerURL() || clinicaldataWrapper.getSubjects().length > 2500;
    if (showLoadingIndicator) ioHelper.showToast(languageHelper.getTranslation("data-loading-hint"));
    dataset = await clinicaldataWrapper.getAllData({ includeInfo: true });
    if (showLoadingIndicator) ioHelper.showToast(languageHelper.getTranslation("data-loaded-hint"), 2500);
    
    loadWidgets();
}

export function reload() {
    loadReport(currentReport);
}

export const loadWidgets = () => {
    widgetComponents = [];
    activeFilters = [];
    $$("#widgets .widget").removeElements();
    if (!currentReport) return;

    // Add placeholder
    if (!currentReport.isStandard) $("#widgets").appendChild(getWidgetPlaceholder());

    // Add widgets
    currentReport.widgets.forEach(widget => addWidgetToGrid(widget));

    // Update widgets
    updateWidgets();
}

const calculateWidgetData = () => {
    if (!currentReport) return;
    const subjectKeys = Object.keys(dataset);
    const subjectData = Object.values(dataset);
    let filteredCount = 0;

    const widgetData = widgetComponents.map(widgetComponent => widgetComponent?.customChart?.widgetData);
    widgetData.filter(entry => entry instanceof reportsHelper.FrequencyWidgetData).forEach(entry => entry.counts.fill(0));
    widgetData.filter(entry => entry instanceof reportsHelper.DiscreteWidgetData).forEach(entry => entry.sortedValues.length = 0);
    for (let i = 0; i < subjectKeys.length; i++) {
        let filteredInGeneral = false;
        for (const entry of widgetData) {
            let filteredForChart = false;
            for (const filter of activeFilters) {
                if (subjectData[i][filter.itemPath] != filter.value) {
                    filteredInGeneral = true;
                    if (entry.itemPath != filter.itemPath) filteredForChart = true;
                }
            }
            if (entry instanceof reportsHelper.FrequencyWidgetData){
                if (filteredForChart) continue;
                const value = subjectData[i][entry.itemPath];
                const index = entry.values.indexOf(value);
                entry.counts[index]++;
            } else if (entry instanceof reportsHelper.DiscreteWidgetData) {
                entry.values[i].filtered = filteredInGeneral;
                if (filteredInGeneral) entry.sortedValues.unshift(entry.values[i]);
                else entry.sortedValues.push(entry.values[i]);
            }
        }
        if (filteredInGeneral) filteredCount++;
    }

    $("#reports-section h1").textContent = (subjectKeys.length - filteredCount) + (activeFilters.length > 0 ? " " + languageHelper.getTranslation("of") + " " + subjectKeys.length : "") + " " + languageHelper.getTranslation("subjects");
    $("#reports-section h2").textContent = activeFilters.length + " " + languageHelper.getTranslation("active-filters");
}

const filterCallback = (itemPath, value) => {
    if (value) addFilter(itemPath, value);
    else removeFilter(itemPath);
    updateWidgets();
}

const addFilter = (itemPath, value) => {
    // No use of data.filter(); since a filter should not be applied for the triggering chart
    activeFilters = activeFilters.filter(filter => filter.itemPath != itemPath);
    activeFilters.push({ itemPath, value });
}

const removeFilter = itemPath => {
    activeFilters = activeFilters.filter(filter => filter.itemPath != itemPath);
}

const updateWidgets = () => {
    calculateWidgetData();
    widgetComponents.forEach(widgetComponent => widgetComponent.update());
}

const reloadWidget = widgetId => {
    const widget = currentReport.widgets.find(widget => widget.id == widgetId);
    const widgetComponent = widgetComponents.find(entry => entry.widget.id == widgetId);

    // First, remove a filter that is possibly set for the widget
    removeFilter(widget.itemPaths[0]);

    // Second, add or replace the chart
    const customChart = getCustomChart(widget);
    if (customChart) {
        widgetComponent.customChart?.chart?.destroy();
        customChart.chart = new Chart(widgetComponent.querySelector("canvas"), customChart.config);;
        widgetComponent.setCustomChart(customChart);
    }

    // Third, update all widgets
    updateWidgets();
}

const removeWidget = widgetId => {
    const widget = currentReport.widgets.find(widget => widget.id == widgetId);

    // Remove widget component and a possibly set filter
    removeFilter(widget.itemPaths[0]);
    widgetComponents = widgetComponents.filter(entry => entry.widget.id != widgetId);
    reportsHelper.removeWidget(currentReport.id, widgetId);

    // Update all widgets
    updateWidgets();
}

const hoverCallback = (chartId, index) => {
    // TODO: Performance with .map() and .filter() on each hover event?
    const customCharts = widgetComponents.map(widgetComponent => widgetComponent.customChart).filter(customChart => customChart);
    for (const customChart of customCharts) {
        if (!(customChart instanceof CustomScatterChart) || customChart.chart.id == chartId) continue;

        if (index != null) customChart.chart.setActiveElements([{ datasetIndex: 0, index: index }]);
        else customChart.chart.setActiveElements([]);
        customChart.chart.update();
    }
}

const addWidgetToGrid = widget => {
    const widgetComponent = document.createElement("widget-component");
    widgetComponent.setWidget(widget);
    widgetComponent.setTitle(widget.isStandard ? languageHelper.getTranslation(widget.name) : widget.name);
    if (currentReport.isStandard) $("#reports-section #widgets").appendChild(widgetComponent);
    else $("#reports-section .widget.is-placeholder").insertAdjacentElement("beforebegin", widgetComponent);

    const customChart = getCustomChart(widget);
    if (customChart) {
        customChart.chart = new Chart(widgetComponent.querySelector("canvas"), customChart.config);
        // TODO: Use setter instead
        widgetComponent.setCustomChart(customChart);
    } else {
        setTimeout(() => widgetComponent.showOptions(), 250);
    }

    widgetComponents.push(widgetComponent);
}

const getCustomChart = widget => {
    switch (widget.type) {
        case reportsHelper.Widget.types.BAR:
            const frequencyWidgetData = getFrequencyWidgetData(widget);
            return new CustomBarChart(frequencyWidgetData, filterCallback);
        case reportsHelper.Widget.types.SCATTER:
            const discreteWidgetData = getDiscreteWidgetData(widget);
            return new CustomScatterChart(discreteWidgetData, hoverCallback);
    }
}

const getFrequencyWidgetData = widget => {
    const [values, labels] = widget.isStandard ? getStandardWidgetValuesLabels(widget) : getCustomWidgetValuesLabels(widget);
    return new reportsHelper.FrequencyWidgetData(
        widget.itemPaths[0],
        Array(values.length),
        labels,
        values
    );
}

const getStandardWidgetValuesLabels = widget => {
    let values, labels;
    switch (widget.itemPaths[0]) {
        case "createdYear":
            const years = getUniqueValues("createdYear");
            values = labels = years.length ? years : [new Date().getFullYear()];
            break;
        case "createdMonth":
            values = Array.from({ length: 12 }, (_, i) => i + 1);
            labels = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1)).map(date => date.toLocaleDateString(languageHelper.getCurrentLocale(), { month: "short" }));
            break;
        case "siteOID":
            values = ["no-site"];
            labels = [languageHelper.getTranslation("no-site")];
            admindataWrapper.getSites().forEach(site => values.push(site.getOID()));
            admindataWrapper.getSites().forEach(site => labels.push(site.getName()));
    }

    return [values, labels];
}

const getUniqueValues = itemPath => {
    return Object.values(dataset).reduce((values, entry) => {
        if (entry[itemPath] && !values.includes(entry[itemPath])) values.push(entry[itemPath]);
        return values;
    }, new Array());
}

const getCustomWidgetValuesLabels = widget => {
    let values, labels;
    const itemOID = ODMPath.parseAbsolute(widget.itemPaths[0]).itemOID;
    switch (metadataWrapper.getElementDefByOID(itemOID).getDataType()) {
        case metadataWrapper.dataTypes.CODELISTTEXT:
        case metadataWrapper.dataTypes.CODELISTINTEGER:
        case metadataWrapper.dataTypes.CODELISTFLOAT:
            const codeListItems = metadataWrapper.getCodeListItemsByItem(itemOID);
            values = codeListItems.map(item => item.getCodedValue());
            labels = codeListItems.map(item => item.getTranslatedDecode(languageHelper.getCurrentLocale()));
            break;
        case metadataWrapper.dataTypes.BOOLEAN:
            values = ["1", "0"];
            labels = [languageHelper.getTranslation("yes"), languageHelper.getTranslation("no")];
    }

    return [values, labels];
}

const getDiscreteWidgetData = widget => {
    // TODO: Evaluate performance of .map() in this scenario
    const values = Object.entries(dataset).map(entry => {
        return {
            x: entry[1][widget.itemPaths[0]],
            y: widget.itemPaths.length > 1 ? entry[1][widget.itemPaths[1]] : Math.random(),
            label: entry[0],
            filtered: false
        };
    });
    return new reportsHelper.DiscreteWidgetData(
        widget.itemPaths,
        values,
        []
    );
}

const getWidgetPlaceholder = () => {
    const placeholder = document.createElement("div");
    placeholder.className = "widget is-placeholder is-flex is-align-items-center is-justify-content-center is-clickable";

    const iconContainer = document.createElement("span");
    iconContainer.className = "icon is-size-1";
    const icon = document.createElement("i");
    icon.className = "fas fa-plus is-clickable";
    iconContainer.appendChild(icon);
    placeholder.appendChild(iconContainer);

    placeholder.onclick = () => addWidget();

    return placeholder;
}

const addWidget = () => {
    const widget = reportsHelper.addWidget(currentReport.id, languageHelper.getTranslation("new-chart"));
    addWidgetToGrid(widget);
}

const loadReportList = () => {
    $$("#standard-reports-list a").removeElements();
    $$("#custom-reports-list a").removeElements();
    for (const report of reportsHelper.getReports()) {
        const reportElement = document.createElement("a");
        reportElement.textContent = report.isStandard ? languageHelper.getTranslation(report.name) : report.name;
        reportElement.setAttribute("id", report.id);
        reportElement.onclick = () => loadReport(report);
        if (currentReport && currentReport.id == report.id) reportElement.activate();
        report.isStandard ? $("#standard-reports-list").appendChild(reportElement) : $("#custom-reports-list").appendChild(reportElement);
    }
    currentReport && !currentReport.isStandard ? $("#edit-report-button").show() : $("#edit-report-button").hide();
}

const loadReport = report => {    
    currentReport = report;
    loadReportList();
    loadWidgets();
}

const addReport = () => {
    const report = reportsHelper.addReport(languageHelper.getTranslation("new-report"));
    loadReportList();
    loadReport(report);
}

const showReportModal = async () => {
    await import("./components/reports/reportmodal.js");
    const reportModal = document.createElement("report-modal");
    reportModal.setReport(currentReport);

    document.body.appendChild(reportModal);
    languageHelper.localize(reportModal);
}

const setIOListeners = () => {
    $("#reports-section #add-report-button").addEventListener("click", () => addReport());
    $("#reports-section #edit-report-button").addEventListener("click", () => showReportModal());

    document.addEventListener("ReportEdited", () => {
        reload();
        reportsHelper.storeReports();
    });
    document.addEventListener("ReportRemoved", event => {
        reportsHelper.removeReport(event.detail);
        loadReport(null);
    });
    document.addEventListener("WidgetEdited", event => {
        reloadWidget(event.detail);
        reportsHelper.storeReports();
    });
    document.addEventListener("WidgetMoved", event => {
        const widgets = currentReport.widgets;
        widgets.splice(event.detail.toIndex, 0, widgets.splice(event.detail.fromIndex, 1)[0]);
        reportsHelper.storeReports();
    });
    document.addEventListener("WidgetRemoved", event => {
        removeWidget(event.detail);
    });
}
