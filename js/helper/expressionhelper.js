import ODMPath from "../odmwrapper/odmpath.js";
import { Parser } from "../../lib/expr-eval.js";

const $ = query => document.querySelector(query);
const $$ = query => document.querySelectorAll(query);

let parser = null;
let conditionVariables = {};
let methodVariables = {};

export function setVariables(variables) {
    conditionVariables = {};
    methodVariables = {};
    
    Object.entries(variables).forEach(([path, value]) => setVariable(path, value));
}

export function setVariable(path, value) {
    const escapedPaths = escapePaths(path);
    conditionVariables[escapedPaths] = !value ? "" : value;

    // Only evaluate method expressions where all variables have a value != ""
    if (value && value != "") methodVariables[escapedPaths] = value;
    else delete methodVariables[escapedPaths];
}

export function process(elements) {
    for (let element of elements) {
        const expression = parse(element.formalExpression);
        if (expression) {
            element.expression = expression;
            element.expression.variables().forEach(variable => {
                const absolutePath = ODMPath.parseRelative(unescapePaths(variable)).getItemAbsolute(element.elementPath);
                element.expression = element.expression.substitute(variable, escapePaths(absolutePath.toString()));
            });

            if (element.expressionType == "condition") processCondition(element);
            else if (element.expressionType == "method") processMethod(element);
        }
    }
}

export function parse(formalExpression) {
    try {
        // Expr-eval does not support dots in variables names which are therefore replaced with underscores
        return getParser().parse(escapePaths(normalizeTokens(formalExpression)));
    } catch (error) {
        // Error while parsing the formal expressions
    }
}

function getParser() {
    if (!parser) parser = new Parser( { operators: { assignment: false } } );
    return parser;
}

function processCondition(condition) {
    // Select conditional item group or item and hide it
    let conditionalElement;
    if (condition.elementType == "itemgroup") conditionalElement = $(`#clinicaldata-content [item-group-content-oid="${condition.elementPath.itemGroupOID}"]`);
    else if (condition.elementType == "item") conditionalElement = $(`#clinicaldata-content [item-field-oid="${condition.elementPath.itemOID}"]`);
    conditionalElement.hide();

    // If the expression evaluates to true, show condition element
    try {
        if (condition.expression.evaluate(conditionVariables)) conditionalElement.show();
    } catch (error) {
        // Error while evaluating the formal expressions
    }
    

    // Add event listeners to respond to inputs to the determinant items
    for (const variable of condition.expression.variables()) {
        const itemPath = ODMPath.parseAbsolute(unescapePaths(variable));
        const inputElement = $(`#clinicaldata-content [item-oid="${itemPath.itemOID}"]`);
        if (!inputElement) continue;
        if (inputElement.getAttribute("type") == "text" || inputElement.getAttribute("type") == "select") {
            inputElement.addEventListener("input", event => respondToInputChangeCondition(event.target, itemPath, condition, conditionalElement));
        } else if (inputElement.getAttribute("type") == "radio") {
            const radioItems = $$(`#clinicaldata-content [item-oid="${itemPath.itemOID}"]`);
            for (const radioItem of radioItems) {
                radioItem.addEventListener("input", event => respondToInputChangeCondition(event.target, itemPath, condition, conditionalElement));
            }
        }
    }
}

function respondToInputChangeCondition(input, itemPath, condition, conditionalElement) {
    setVariable(itemPath.toString(), input.value);
    showOrHideConditionalElement(conditionalElement, condition.expression.evaluate(conditionVariables));
}

function showOrHideConditionalElement(conditionalElement, show) {
    if (show) {
        conditionalElement.show();
    } else {
        conditionalElement.hide();
        emptyConditionalElement(conditionalElement);
    }
}

function emptyConditionalElement(conditionalElement) {
    // For performance purposes, only send one radio input event for a group of radio buttons
    let lastRadioItemOID;

    const inputElements = conditionalElement.querySelectorAll("[item-oid]");
    for (const inputElement of inputElements) {
        if (inputElement.getAttribute("type") == "text" || inputElement.getAttribute("type") == "textarea" || inputElement.getAttribute("type") == "date") {
            inputElement.value = "";
            inputElement.dispatchEvent(new Event("input"));
        } else if (inputElement.getAttribute("type") == "select") {
            inputElement.selectedIndex = 0;
            inputElement.dispatchEvent(new Event("input"));
        } else if (inputElement.getAttribute("type") == "radio") {
            inputElement.checked = false;
            const itemOID = inputElement.getAttribute("item-oid");
            if (itemOID != lastRadioItemOID) {
                const event = new Event("input");
                Object.defineProperty(event, "target", { value: "", enumerable: true });
                inputElement.dispatchEvent(event);
                lastRadioItemOID = itemOID;
            }
        }
    }
}

function processMethod(method) {
    // Select conditional item group or item and make it read-only
    let computedElement = $(`#clinicaldata-content [item-oid="${method.elementPath.itemOID}"]`);
    computedElement.readOnly = true;

    // If a value can already be calculated, assign it
    computedElement.value = computeExpression(method);

    // Add event listeners to respond to inputs to the determinant items
    for (const variable of method.expression.variables()) {
        const itemPath = ODMPath.parseAbsolute(unescapePaths(variable));
        const inputElement = $(`#clinicaldata-content [item-oid="${itemPath.itemOID}"]`);
        if (!inputElement) continue;
        if (inputElement.getAttribute("type") != "radio") {
            inputElement.addEventListener("input", event => respondToInputChangeMethod(event.target, itemPath, method, computedElement));
        } else {
            const radioItems = $$(`#clinicaldata-content [item-oid="${itemPath.itemOID}"]`);
            for (const radioItem of radioItems) {
                radioItem.addEventListener("input", event => respondToInputChangeMethod(event.target, itemPath, method, computedElement));
            }
        }
    }
}

function respondToInputChangeMethod(input, itemPath, method, computedElement) {
    setVariable(itemPath.toString(), input.value ? input.value.replace(",", ".") : null);

    computedElement.value = computeExpression(method);
    computedElement.dispatchEvent(new Event("input"));
}

function computeExpression(method) {
    try {
        const computedValue = method.expression.evaluate(methodVariables);
        if (!isNaN(computedValue)) return isFinite(computedValue) ? Math.round(computedValue * 100) / 100 : null;
        else return computedValue;
    } catch (error) {
        return "";
    }
}

// Helper functions
function normalizeTokens(expression) {
    return expression.replace(/( AND | OR | && | \|\ )/g, function(string) {
        switch (string) {
            case " AND ": return " and ";
            case " OR ": return " or ";
            case " && ": return " and ";
            case " || ": return " or ";
        }
    });
}

// TODO: Does currently not work with decimal numbers (point will be replaced with underscores, previous regexp: ([a-zA-Z][a-zA-Z0-9]*)\.([a-zA-Z0-9\.]+))
function escapePaths(expression) {
    return expression.replace(/-/g, "____").replace(/(\w)\.(?=\w)/g, "$1__");
}

function unescapePaths(expression) {
    return expression.replace(/____/g, "-").replace(/(\w)__(?=\w)/g, "$1.");
}
