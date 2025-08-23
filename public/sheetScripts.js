import { dice, skillList, baseCharacteristics, modifier, classNames, validColors } from "./helpers.js";

export const doc = {
    frontPageSubmitButton: document.getElementById("frontPageSubmitButton"),
    frontMenuCodeInput: document.getElementById("frontMenuCodeInput"),
    tableViewContainer: document.getElementById("tableViewContainer"),
    frontMenuContainer: document.getElementById("frontMenuContainer"),
    contextMenu: document.getElementById("contextMenu"),
    characterInventoryMainPanel: document.getElementById("characterInventoryMainPanel"),
    characterInventoryDescriptionPanel: document.getElementById("characterInventoryDescriptionPanel"),
    characterInventoryDescriptionPanelTitle: document.getElementById("characterInventoryDescriptionPanelTitle"),
    characterClassesClassSubpanel: document.getElementById("characterClassesClassSubpanel"),
    popupMenu: document.getElementById("popupMenu"),
    popupMenuHeader: document.getElementById("popupMenuHeader"),
    popupMenuDescription: document.getElementById("popupMenuDescription"),
    popupMenuSingleButton: document.getElementById("popupMenuSingleButton"),
    popupMenuLeftDoubleButton: document.getElementById("popupMenuLeftDoubleButton"),
    popupMenuRightDoubleButton: document.getElementById("popupMenuRightDoubleButton"),
    popupMenuInput: document.getElementById("popupMenuInput"),
    popupMenuFileDrop: document.getElementById("popupMenuFileDrop"),
    popupMenuFileDropLabel: document.getElementById("popupMenuFileDropLabel"),
    characterReferenceSideMenu: document.getElementById("characterReferenceSideMenu"),
    diceRollPopupHolder: document.getElementById("diceRollPopupHolder"),
    gameCanvas: document.getElementById("gameCanvas"),
    buildCanvas: document.getElementById("buildCanvas"),
    tokenDataMenu: document.getElementById("tokenDataMenu"),
    gridDataMenu: document.getElementById("gridDataMenu"),
}

// basic data storage for characters, and the currently viewed character
async function loadDefaultCharacterSheet() {
    psd.sheets.push(await (await fetch("./json/defaultCharacterSheet.json")).json());
    currentSelectedCharacter = psd.sheets[0];
    fillCharacterFields(currentSelectedCharacter);
}
export let currentSelectedCharacter = null;
export let classData = {};
export let psd = {
    mousePosition: {x: 0, y: 0},
    cameraLocation: {x: 0, y: 0, s: 1},
    originalCameraLocation: {x: 0, y: 0},
    players: [],
    tokens: [],
    grids: [],
    images: [],
    sheets: [],
    myId: -1,
    inMenu: false,
    currentEditObject: null
};

if (localStorage.getItem("psd")) psd = JSON.parse(localStorage.getItem("psd"));
else await loadDefaultCharacterSheet();

export function randomColor(noWhites = false) {
    if (noWhites) return validColors[Math.floor(Math.random() * (validColors.length - 7)) + 7];
    return validColors[Math.floor(Math.random() * validColors.length)];
}
export let preferences = {
    mouseColor: randomColor(true),
};

// possible error popups
function error(id) {
    switch (id) {
        case 0: {
            createPopup("Error", "This character cannot be found.", {type: 0}, "Ok", function(e) {return true});
            return false;
        }
    }
}

// finds a specific asset from our saved assets via id and name
export function findAsset(id, name) {
    for (let asset of psd.images) if (asset.id === id && asset.name === name) return asset;
    for (let asset of psd.tokens) if (asset.id === id && asset.name === name) return asset;
    for (let asset of psd.sheets) if (asset.id === id && asset.name === name) return asset;
    for (let asset of psd.grids) if (asset.id === id && asset.name === name) return asset;

    return null;
}

//_ custom select menu code
let x, i, j, l, ll, selElmnt, a, b, c;
// look for any elements with the class "custom-select":
x = document.getElementsByClassName("customSelectObject");
l = x.length;
for (i = 0; i < l; i++) {
  selElmnt = x[i].getElementsByTagName("select")[0];
  ll = selElmnt.length;
  // for each element, create a new DIV that will act as the selected item:
  a = document.createElement("DIV");
  a.setAttribute("class", "customSelectObject-selected");
  a.innerHTML = selElmnt.options[selElmnt.selectedIndex].innerHTML;
  x[i].appendChild(a);
  // for each element, create a new DIV that will contain the option list:
  b = document.createElement("DIV");
  b.setAttribute("class", "customSelectObject-items customSelectObject-hide");
  for (j = 0; j < ll; j++) {
    // for each option in the original select element, create a new DIV that will act as an option item:
    c = document.createElement("DIV");
    c.innerHTML = selElmnt.options[j].innerHTML;
    c.addEventListener("click", function(e) {
        // when an item is clicked, update the original select box, and the selected item:
        let y, i, k, s, h, sl, yl;
        s = this.parentNode.parentNode.getElementsByTagName("select")[0];
        sl = s.length;
        h = this.parentNode.previousSibling;
        for (i = 0; i < sl; i++) {
          if (s.options[i].innerHTML == this.innerHTML) {
            s.selectedIndex = i;
            h.innerHTML = this.innerHTML;
            y = this.parentNode.getElementsByClassName("same-as-customSelectObject");
            yl = y.length;
            for (k = 0; k < yl; k++) {
              y[k].removeAttribute("class");
            }
            this.setAttribute("class", "same-as-customSelectObject");
            break;
          }
        }
        h.click();
    });
    b.appendChild(c);
  }
  x[i].appendChild(b);
  a.addEventListener("click", function(e) {
      // when the select box is clicked, close any other select boxes, and open/close the current select box:
      e.stopPropagation();
      closeAllSelect(this);
      this.nextSibling.classList.toggle("customSelectObject-hide");
      this.classList.toggle("customSelectObject-arrow-active");
    });
}
function closeAllSelect(elmnt) {
  // a function that will close all select boxes in the document,except the current select box:
  let x, y, i, xl, yl, arrNo = [];
  x = document.getElementsByClassName("customSelectObject-items");
  y = document.getElementsByClassName("customSelectObject-selected");
  xl = x.length;
  yl = y.length;
  for (i = 0; i < yl; i++) {
    if (elmnt == y[i]) {
      arrNo.push(i)
    } else {
      y[i].classList.remove("customSelectObject-arrow-active");
    }
  }
  for (i = 0; i < xl; i++) {
    if (arrNo.indexOf(i)) {
      x[i].classList.add("customSelectObject-hide");
    }
  }
  // we also close the context menu after a click, if not already closed
  doc.contextMenu.classList.add("hidden");
}
// if the user clicks anywhere outside the select box, then close all select boxes:
document.addEventListener("click", closeAllSelect);

//_ Document event listeners

// the right click event, which opens the context menu on an item if applicable, or otherwise starts an event
document.addEventListener("contextmenu", function(e) {
    doc.contextMenu.style.left = `${e.clientX - 3}px`;
    doc.contextMenu.style.top = `${e.clientY - 3}px`;
    doc.contextMenu.classList.remove("hidden");
});

// if the context menu is moved off of, it is hidden
doc.contextMenu.addEventListener("mouseleave", function(e) {
    doc.contextMenu.classList.add("hidden");
    while (doc.contextMenu.children.length > 0) doc.contextMenu.lastChild.remove();
});

// adds the right click menu to the base statistics input for rolling random stats
let baseCharacteristicInputs = [
    document.getElementById("strCharacteristicBaseField"),
    document.getElementById("dexCharacteristicBaseField"),
    document.getElementById("conCharacteristicBaseField"),
    document.getElementById("wisCharacteristicBaseField"),
    document.getElementById("intCharacteristicBaseField"),
    document.getElementById("chaCharacteristicBaseField"),
];
for (let input of baseCharacteristicInputs) input.addEventListener("contextmenu", function(e) {
    populateRightClick([{
        name: "Randomize Base Stats",
        function: function() {
            createPopup("Confirm Randomization", "Do you want to randomize your base stats using the standard 4d6, take 3 method?", {type: 0}, "No", function(e){return true},
            "Yes", function(e){
                for (let input of baseCharacteristicInputs) {
                    let lowestRoll = 6;
                    let total = 0;
                    let rolls = [];
                    for (let i = 0; i < 4; i++) {
                        let roll = dice(6);
                        if (roll < lowestRoll) lowestRoll = roll;
                        total += roll;
                        rolls.push(roll);
                    }
                    total -= lowestRoll;
                    input.value = total;
                }
                return true;
            });
        }
    }]);
});

// if an "add modifier" button is pressed on the characteristics page, add a modifier slot
let modButtons = [
    document.getElementById("classesStrengthModBtn"), document.getElementById("strClassesCharacteristicsBox"),
    document.getElementById("classesDexterityModBtn"), document.getElementById("dexClassesCharacteristicsBox"),
    document.getElementById("classesConstitutionModBtn"), document.getElementById("conClassesCharacteristicsBox"),
    document.getElementById("classesWisdomModBtn"), document.getElementById("wisClassesCharacteristicsBox"),
    document.getElementById("classesIntelligenceModBtn"), document.getElementById("intClassesCharacteristicsBox"),
    document.getElementById("classesCharismaModBtn"), document.getElementById("chaClassesCharacteristicsBox"),
];
for (let i = 0; i < modButtons.length; i += 2) modButtons[i].addEventListener("click", function(e) {
    createPopup(
        "Create Modifier", "Please select a name for this modifier. To delete it later, right click it.",
        {type: 1, placeholder: "Custom Modifier", maxlength: 32},
        "Cancel", function(e) {return true},
        "Submit", function(e) {
            // creates a new custom modifier
            if (!currentSelectedCharacter) return error(0);
            currentSelectedCharacter.modifiers.push({
                type: "characteristic",
                target: baseCharacteristics[i/2],
                name: doc.popupMenuInput.value || "Custom Modifier",
                amount: 0
            });
            fillCharacterFields(currentSelectedCharacter);
            return true;
        }
    );
});

// adds an update when changing the character's fields
for (let char of baseCharacteristics) document.getElementById(`${char}CharacteristicBaseField`).addEventListener("change", function(e) {
    if (!currentSelectedCharacter) return error(0);
    currentSelectedCharacter.baseCharacteristics[char] = parseInt(document.getElementById(`${char}CharacteristicBaseField`).value);
    fillCharacterFields(currentSelectedCharacter);
});

document.getElementById(`characterHealthField`).addEventListener("change", function(e) {
    if (!currentSelectedCharacter) return error(0);
    currentSelectedCharacter.status.health = parseInt(document.getElementById(`characterHealthField`).value);
    fillCharacterFields(currentSelectedCharacter);
});

// when a section tab is pressed in the character creation menu, hide all other pages
let characterSubsectionTabs = [
    document.getElementById("characterInventoryTab"),
    document.getElementById("characterActionsTab"),
    document.getElementById("characterStatusTab"),
    document.getElementById("characterClassesTab"),
];
let characterSubsectionIds = [
    document.getElementById("characterInventoryPage"),
    document.getElementById("characterActionsPage"),
    document.getElementById("characterStatusPage"),
    document.getElementById("characterClassesPage"),
];
for (let tab of characterSubsectionTabs) tab.addEventListener("click", function(e) {
    for (let i = 0; i < characterSubsectionTabs.length; i++) {
        characterSubsectionTabs[i].classList.remove("selectedSubsectionTab");
        characterSubsectionIds[i].classList.add("hidden");
        if (characterSubsectionTabs[i] === tab) {
            characterSubsectionIds[i].classList.remove("hidden");
            tab.classList.add("selectedSubsectionTab");
        }
    }
});

// a similar thing, except for the subsection tabs under the classes category
let classesSubsectionTabs = [
    document.getElementById("characterClassesClassButton"),
    document.getElementById("characterClassesRaceButton"),
    document.getElementById("characterClassesBackgroundButton"),
    document.getElementById("characterClassesCharacteristicsButton"),
];
let classesSubsectionIds = [
    document.getElementById("characterClassesClassSubpanel"),
    document.getElementById("characterClassesRaceSubpanel"),
    document.getElementById("characterClassesBackgroundSubpanel"),
    document.getElementById("characterClassesCharacteristicsSubpanel"),
];
for (let tab of classesSubsectionTabs) tab.addEventListener("click", function(e) {
    for (let i = 0; i < classesSubsectionTabs.length; i++) {
        classesSubsectionTabs[i].classList.remove("selectedCharacterClassesButton");
        classesSubsectionIds[i].classList.add("hidden");
        if (classesSubsectionTabs[i] === tab) {
            classesSubsectionIds[i].classList.remove("hidden");
            tab.classList.add("selectedCharacterClassesButton");
        }
    }
});

doc.characterReferenceSideMenu.addEventListener("contextmenu", function(e) {
    doc.characterReferenceSideMenu.classList.add("characterReferenceSideMenuClosed");
});

doc.characterReferenceSideMenu.addEventListener("mousemove", function(e) {
    if (Math.abs(e.clientX - doc.characterReferenceSideMenu.getBoundingClientRect().right) < 20) {
        doc.characterReferenceSideMenu.classList.add("characterSideMenuDraggable");
    } else doc.characterReferenceSideMenu.classList.remove("characterSideMenuDraggable");
});
doc.characterReferenceSideMenu.addEventListener("mousedown", function(e) {
    function dragging(e2) {
        e2.preventDefault();
        doc.characterReferenceSideMenu.classList.add("characterSideMenuDragging");
        doc.characterReferenceSideMenu.style.width = `${Math.max(e2.clientX, 100)}px`;
    }
    function removedragging(e2) {
        document.removeEventListener("mousemove", dragging);
        document.removeEventListener("mouseup", removedragging);
        doc.characterReferenceSideMenu.classList.remove("characterSideMenuDragging");
    }
    if (Math.abs(e.clientX - doc.characterReferenceSideMenu.getBoundingClientRect().right) < 20) {
        e.preventDefault();
        document.addEventListener("mousemove", dragging);
        document.addEventListener("mouseup", removedragging);
    }
});

doc.popupMenuFileDrop.addEventListener("change", function(e) {
    if (doc.popupMenuFileDrop.files.length <= 0) {
        doc.popupMenuFileDropLabel.innerText = "Click to Upload a File";
        return;
    }
    const file = doc.popupMenuFileDrop.files[0];
    doc.popupMenuFileDropLabel.innerText = `${file.name} (${Math.ceil(file.size/1024)} KB)`;
});

// add colors options to all marked selects
for (let select of document.getElementsByClassName("colorInputAutofill")) {
    for (let color of validColors) {
        let option = document.createElement("option");
        option.value = color;
        option.innerText = color[0].toUpperCase() + color.substring(1);
        select.appendChild(option);
    }
}

// makes it where all file drops show the file they are holding correctly
for (let fileDrop of document.getElementsByClassName("fileDropAutofill")) {
    document.getElementById(fileDrop.htmlFor).addEventListener("change", function(e) {
        if (document.getElementById(fileDrop.htmlFor).files.length <= 0) {
            fileDrop.innerText = "Click to Upload a File";
            return;
        }
        const file = document.getElementById(fileDrop.htmlFor).files[0];
        fileDrop.innerText = `${file.name} (${Math.ceil(file.size/1024)} KB)`;
    });
}

//_ Character sheet functionalities

// when the user opens the right click menu, this adds all the options for an item
export function populateRightClick(buttons = []) {
    while (doc.contextMenu.children.length > 0) doc.contextMenu.lastChild.remove();

    for (let button of buttons) {
        let contextBtn = document.createElement("button");
        contextBtn.classList.add("contextMenuButton");
        contextBtn.innerText = button.name;
        contextBtn.addEventListener("click", button.function);

        doc.contextMenu.appendChild(contextBtn);
    }
}

// we have a giant set of req for this, so we import a ton of data from 5etools jsons
async function fetchReferenceData(file, objectName) {
    return (await (await fetch(file)).json())[objectName];
}
let referenceData = {
    "@action": await fetchReferenceData("./json/data/actions.json", "action"),
    "@condition": await fetchReferenceData("./json/data/conditionsdiseases.json", "condition"),
    "@disease": await fetchReferenceData("./json/data/conditionsdiseases.json", "disease"),
    "@status": await fetchReferenceData("./json/data/conditionsdiseases.json", "status"),
    "@variantrule": await fetchReferenceData("./json/data/variantrules.json", "variantrule"),
    "@feat": await fetchReferenceData("./json/data/feats.json", "feat"),
    "@item": await fetchReferenceData("./json/data/items.json", "item"),
    "@skill": await fetchReferenceData("./json/data/skills.json", "skill"),
    "@spell": await fetchReferenceData("./json/data/spells/spells-xphb.json", "spell"),
    "@itemMastery": await fetchReferenceData("./json/masteryProperties.json", "itemMastery"),
    "@optionalfeature": await fetchReferenceData("./json/data/optionalfeatures.json", "optionalfeature"),
    "@sense": await fetchReferenceData("./json/data/senses.json", "sense"),
    "book-phb": await fetchReferenceData("./json/data/book/book-phb.json", "data"),
};
let creatureData = {};
async function fetchCreatureData() {
    let indexing = (await (await fetch("./json/data/bestiary/index.json")).json());
    for (let i of Object.keys(indexing)) {
        creatureData[i] = await fetchReferenceData(`./json/data/bestiary/${indexing[i]}`, "monster");
    }
}
await fetchCreatureData();

// creates a popup on the lower left showing the roll and result from some syntax
function createDiceRoll(syntax) {
    let diceGroups = syntax.split(" ");
    let outcome = 0;
    let rolls = [];
    let face = 0;
    for (let d of diceGroups) {
        let num = parseInt(d.substring(0, d.indexOf("d")) || 1);
        let faces = parseInt(d.substring(d.indexOf("d") + 1));
        for (let i = 0; i < num; i++) {
            let roll = dice(faces);
            outcome += roll;
            rolls.push(roll);
            face = faces;
        }
    }

    while (doc.diceRollPopupHolder.children.length > 3) doc.diceRollPopupHolder.firstChild.remove();

    let rollPopup = document.createElement("div");
    rollPopup.classList.add("diceRollPopup");
    
    let rollInfo = document.createElement("p");
    rollInfo.classList.add("diceRollPopupInfo");
    if (rolls.length > 1) {
        rollInfo.innerHTML = `Rolled ${syntax}<br>`;
        for (let i = 0; i < rolls.length; i++) {
            rollInfo.innerHTML += rolls[i];
            if (i + 1 < rolls.length) rollInfo.innerHTML += " + ";
            else rollInfo.innerHTML += " =";
        }
    } else rollInfo.innerHTML = `Rolled a d${face}`;
    rollPopup.appendChild(rollInfo);

    let rollValue = document.createElement("h1");
    rollValue.classList.add("diceRollPopupValue");
    rollValue.innerText = outcome;
    rollPopup.appendChild(rollValue);

    rollPopup.addEventListener("click", function(e) {
        if (doc.diceRollPopupHolder.children.length === 4) doc.diceRollPopupHolder.firstChild.remove();
        doc.diceRollPopupHolder.removeChild(rollPopup);
    });

    doc.diceRollPopupHolder.appendChild(rollPopup);

    requestAnimationFrame(function() {
        rollPopup.classList.add("diceRollPopupOpened");
    });
}

// updates info into the reference side holder
function openReference(elmType, elmClasses, text, clickFunction, parent, override = false) {
    let elm = document.createElement(elmType);
    for (let c of elmClasses) elm.classList.add(c);
    elm.innerText = text;
    elm.addEventListener("click", function(e) {
        if (!override) {
            while (doc.characterReferenceSideMenu.children.length > 0) doc.characterReferenceSideMenu.lastChild.remove();
            let header = document.createElement("h1");
            header.classList.add("characterReferenceSideMenuHeader", "characterReferenceSideMenuObject");
            header.innerText = `${text[0].toUpperCase() + text.substring(1)}`;
            doc.characterReferenceSideMenu.appendChild(header);
            doc.characterReferenceSideMenu.classList.remove("characterReferenceSideMenuClosed");
        }
        clickFunction(e);
    });
    parent.appendChild(elm);
}

// goes through and returns a p element for text with reference brackets
function parseBrackets(text) {
    let split = text.split(/{|}/);
    let final = document.createElement("p");
    final.classList.add("spanHoldingP");
    let parity = 1
    while (split.length > 0) {
        parity *= -1;
        if (parity === -1) {
            final.appendChild(document.createTextNode(split.shift()));
            continue;
        }
        let loc = split[0].split("|");
        // find the reference if applicable
        if (referenceData[loc[0].split(" ")[0]] !== undefined) {
            let dataSheet = referenceData[loc[0].split(" ")[0]];
            let refFound = false;
            for (let n of dataSheet) {
                if (n.name.toLowerCase() !== loc[0].substring(loc[0].indexOf(" ") + 1).toLowerCase() || n.reprintedAs) continue;
                refFound = true;
                openReference("span", ["characterReferenceHoverText"], n.name, function(e) {
                    extractEntries(n.entries, doc.characterReferenceSideMenu, {
                        header: ["characterReferenceSideMenuObject", "characterReferenceSideMenuHeader", "center"],
                        content: [],
                        general: ["characterReferenceSideMenuObject", "center"],
                        tableHeader: ["characterTableEntry", "characterTableEntryHeader"],
                        table: ["characterTableEntry"],
                        inset: ["characterInsetHeader"],
                        dontChangeParent: true
                    });
                }, final);
            }
            if (!refFound) {
                let errorBracket = document.createElement("span");
                errorBracket.classList.add("characterReferenceHoverText");
                errorBracket.innerText = loc[0].substring(loc[0].indexOf(" ") + 1);
                errorBracket.style.backgroundColor = "green";
                errorBracket.style.color = "black";
                console.log(`no reference found for ${loc}`);
                final.appendChild(errorBracket);
            }
        }
        else switch (loc[0].split(" ")[0]) {
            case "@filter": {
                // create a list of every single item of the filtered type
                if (loc[1] === "items") {
                    openReference("span", ["characterReferenceHoverText"], loc[0].substring(loc[0].indexOf(" ") + 1), function(e) {
                        for (let i of referenceData["@item"]) {
                            if (i.weaponCategory !== loc[2].substring(5).split(" ")[0]) continue;
                            openReference("p", ["characterReferenceHoverText", "characterReferenceSideMenuObject"], i.name, function(e) {
                                extractEntries(i.entries, doc.characterReferenceSideMenu, {
                                    header: ["characterReferenceSideMenuObject", "characterReferenceSideMenuHeader", "center"],
                                    content: [],
                                    general: ["characterReferenceSideMenuObject", "center"],
                                    tableHeader: ["characterTableEntry", "characterTableEntryHeader"],
                                    table: ["characterTableEntry"],
                                    inset: ["characterInsetHeader"],
                                    dontChangeParent: true
                                });
                            }, doc.characterReferenceSideMenu);
                        }
                    }, final);
                } else if (loc[1] === "feats") {
                    openReference("span", ["characterReferenceHoverText"], loc[0].substring(loc[0].indexOf(" ") + 1), function(e) {
                        for (let i of referenceData["@feat"]) {
                            if (i.category !== loc[2].substring(9)) continue;
                            openReference("p", ["characterReferenceHoverText", "characterReferenceSideMenuObject"], i.name, function(e) {
                                extractEntries(i.entries, doc.characterReferenceSideMenu, {
                                    header: ["characterReferenceSideMenuObject", "characterReferenceSideMenuHeader", "center"],
                                    content: [],
                                    general: ["characterReferenceSideMenuObject", "center"],
                                    tableHeader: ["characterTableEntry", "characterTableEntryHeader"],
                                    table: ["characterTableEntry"],
                                    inset: ["characterInsetHeader"],
                                    dontChangeParent: true
                                });
                            }, doc.characterReferenceSideMenu);
                        }
                    }, final);
                } else if (loc[1] === "spells") {
                    openReference("span", ["characterReferenceHoverText"], loc[0].substring(loc[0].indexOf(" ") + 1), function(e) {
                        for (let i of referenceData["book-phb"]) {
                            if (i.name !== "Spells" && i.page !== 207) continue;
                            //{@filter Bard spell list|spells|class=Bard}
                            for (let j of i.entries) {
                                if (!j.entries) continue;
                                if (j.name.split(" ")[0] !== loc[2].substring(6)) continue;
                                for (let k of j.entries) {
                                    let header = document.createElement("p");
                                    header.classList.add("characterReferenceSideMenuObject", "characterReferenceSideMenuHeader", "center");
                                    header.innerText = k.name;
                                    doc.characterReferenceSideMenu.appendChild(header);
                                    for (let l of k.items) {
                                        extractEntries([l], doc.characterReferenceSideMenu, {
                                            header: ["characterReferenceHoverText", "characterReferenceSideMenuObject"],
                                            content: [],
                                            general: ["characterReferenceHoverText", "characterReferenceSideMenuObject"],
                                            tableHeader: ["characterTableEntry", "characterTableEntryHeader"],
                                            table: ["characterTableEntry"],
                                            inset: ["characterInsetHeader"],
                                            dontChangeParent: true
                                        });
                                    }
                                }
                            }
                        }
                    }, final);
                } else if (loc[1] === "optionalfeatures") {
                    openReference("span", ["characterReferenceHoverText"], loc[0].substring(loc[0].indexOf(" ") + 1), function(e) {
                        for (let i of referenceData["@optionalfeature"]) {
                            if (!i.featureType.includes(loc[2].substring(13)) || !i.srd52) continue;
                            openReference("p", ["characterReferenceHoverText", "characterReferenceSideMenuObject"], i.name, function(e) {
                                extractEntries(i.entries, doc.characterReferenceSideMenu, {
                                    header: ["characterReferenceSideMenuObject", "characterReferenceSideMenuHeader", "center"],
                                    content: [],
                                    general: ["characterReferenceSideMenuObject", "center"],
                                    tableHeader: ["characterTableEntry", "characterTableEntryHeader"],
                                    table: ["characterTableEntry"],
                                    inset: ["characterInsetHeader"],
                                    dontChangeParent: true
                                });
                            }, doc.characterReferenceSideMenu);
                        }
                    }, final);
                } else if (loc[1] === "bestiary") {
                    final.appendChild(document.createTextNode(loc[0].substring(loc[0].indexOf(" ") + 1)));
                } else console.log("unrecognized filter!", loc[1]);
                break;
            }
            case "@creature": {
                let dataSheet = creatureData[loc[1]];
                for (let n of dataSheet) {
                    if (n.name.toLowerCase() !== loc[0].substring(loc[0].indexOf(" ") + 1).toLowerCase() || n.reprintedAs) continue;
                    openReference("span", ["characterReferenceHoverText"], n.name, function(e) {
                        /*extractEntries(n.entries, doc.characterReferenceSideMenu, {
                            header: ["characterReferenceSideMenuObject", "characterReferenceSideMenuHeader", "center"],
                            content: [],
                            general: ["characterReferenceSideMenuObject", "center"],
                            dontChangeParent: true
                        });*/
                        //! come back to this later and open up something for the creature, maybe a bestiary sheet
                    }, final);
                }
                break;
            }
            case "@5etools": {
                if (loc[0].split(" ")[1] === "feat") {
                    openReference("span", ["characterReferenceHoverText"], loc[0].substring(loc[0].indexOf(" ") + 1), function(e) {
                        for (let i of referenceData["@feat"]) {
                            openReference("p", ["characterReferenceHoverText", "characterReferenceSideMenuObject"], i.name, function(e) {
                                extractEntries(i.entries, doc.characterReferenceSideMenu, {
                                    header: ["characterReferenceSideMenuObject", "characterReferenceSideMenuHeader", "center"],
                                    content: [],
                                    general: ["characterReferenceSideMenuObject", "center"],
                                    tableHeader: ["characterTableEntry", "characterTableEntryHeader"],
                                    table: ["characterTableEntry"],
                                    inset: ["characterInsetHeader"],
                                    dontChangeParent: true
                                });
                            }, doc.characterReferenceSideMenu);
                        }
                    }, final);
                } else console.log("unrecognized 5etools reference!", loc[0].split(" ")[1]);
                break;
            }
            case "@damage": {
                openReference("span", ["characterReferenceHoverText"], loc[0].substring(loc[0].indexOf(" ") + 1), function(e) {
                    createDiceRoll(loc[0].substring(loc[0].indexOf(" ") + 1));
                }, final, true);
                break;
            };
            case "@dice": {
                openReference("span", ["characterReferenceHoverText"], loc[0].substring(loc[0].indexOf(" ") + 1), function(e) {
                    createDiceRoll(loc[0].substring(loc[0].indexOf(" ") + 1));
                }, final, true);
                break;
            };
            case "@dc": {
                final.appendChild(document.createTextNode(`DC ${loc[0].split(" ")[1]}`));
                break;
            }
            case "@book": {
                final.appendChild(document.createTextNode(`${loc[0].substring(loc[0].indexOf(" ") + 1)} of the ${loc[1]}`));
                break;
            }
            default: {
                let errorBracket = document.createElement("span");
                errorBracket.classList.add("characterReferenceHoverText");
                errorBracket.innerText = `Missing Reference!`;
                errorBracket.style.backgroundColor = "red";
                errorBracket.style.color = "black";
                console.log(loc[0].split(" ")[0], text);
                final.appendChild(errorBracket);
                break;
            }
        }
        split.shift();
    }
    return final;
}

// extracts the entries and creates text objects for them
function extractEntries(entries, parent, extractClasses = {header: [], content: [], general: []}, depth = 0) {
    for (let entry of entries) {
        // create a header element if the entry has one
        if (entry.name) {
            let header = document.createElement("p");
            for (let trait of extractClasses.header) header.classList.add(trait);
            if (entry.type === "inset" && extractClasses.inset) for (let trait of extractClasses.inset) header.classList.add(trait);
            header.innerText = entry.name;
            parent.appendChild(header);
        }

        let e = document.createElement("p");
        for (let trait of extractClasses.general) e.classList.add(trait);
        if (depth === 0) for (let trait of extractClasses.content) e.classList.add(trait);
        // check what type the entry is, or show it as text by default
        switch (entry.type) {
            case "entries": case "inset": {
                extractEntries(entry.entries, extractClasses.dontChangeParent ? parent : e, extractClasses, depth + 1);
                if (extractClasses.dontChangeParent) continue;
                break;
            }
            case "list": {
                for (let i of entry.items) {
                    switch (i.type) {
                        case "item": {
                            let header = document.createElement("p");
                            for (let trait of extractClasses.header) header.classList.add(trait);
                            header.innerText = `- ${i.name}`;
                            parent.appendChild(header);

                            extractEntries(i.entries, extractClasses.dontChangeParent ? parent : e, extractClasses, depth + 1);
                            if (extractClasses.dontChangeParent) continue;
                            break;
                        }
                        case undefined: {
                            extractEntries([`- ${i}`], extractClasses.dontChangeParent ? parent : e, extractClasses, depth + 1);
                            if (extractClasses.dontChangeParent) continue;
                            break;
                        }
                        default: {
                            console.log("unrecognized list type");
                            break;
                        }
                    }
                }
                if (extractClasses.dontChangeParent) continue;
                break;
            }
            case "table": {
                let table = document.createElement("div");
                table.classList.add("characterReferenceTable");
                let colLayout = "";
                for (let i of entry.colStyles) {
                    colLayout += `${i.split(" ")[0].substring(4)}fr `;
                }
                table.style.gridTemplateColumns = colLayout;
                
                if (entry.colLabels.length !== entry.colStyles.length) console.log(`BS Table alert: ${entry}`)

                for (let i = 0; i < entry.colLabels.length; i++) {
                    let tableData = document.createElement("div");
                    for (let trait of extractClasses.tableHeader) tableData.classList.add(trait);
                    if (entry.colStyles[i].includes("text-center")) tableData.classList.add("centerText");
                    tableData.innerText = entry.colLabels[i];
                    table.appendChild(tableData);
                }

                for (let i = 0; i < entry.rows.length; i++) {
                    for (let j = 0; j < entry.rows[i].length; j++) {
                        let tableData = document.createElement("div");
                        for (let trait of extractClasses.table) tableData.classList.add(trait);
                        if (entry.colStyles[j] && entry.colStyles[j].includes("text-center")) tableData.classList.add("centerText");
                        tableData.appendChild(parseBrackets(entry.rows[i][j]));
                        table.appendChild(tableData);
                    }
                }

                e.appendChild(table);
                break;
            }
            case undefined: {
                // if we have pure text leftover, we need to run the text through our parser to link bracketed text
                if (entry.includes("@i ")) {
                    console.log(`discarding options rule: ${entry}`);
                    break;
                }
                e.appendChild(parseBrackets(entry));
                break;
            }
            default: {
                e.style.backgroundColor = "var(--red)";
                e.innerText = entry.type;
                console.log(`Unknown Entry Type: ${entry.type} as`);
                console.log(entry)
                break;
            }
        }
        parent.appendChild(e);
    }
}

// populate the description menu for an item, showing all of its traits and stuff
function populateDescriptionPanel(item) {
    // remove all current items in it except the title, which always exists
    while (doc.characterInventoryDescriptionPanel.children.length > 1) doc.characterInventoryDescriptionPanel.lastChild.remove();
    doc.characterInventoryDescriptionPanelTitle.innerText = item.name;

    // check the properties on the item, and create a keyword list for it
    let keywords = document.createElement("p");
    keywords.classList.add("characterInventoryDescriptionPanelObject", "characterInventoryDescriptionPanelHeader", "subscript", "italic");
    let keywordList = [];
    if (item.wondrous) keywordList.push("Wondrous Item");
    if (item.rarity) keywordList.push(item.rarity.charAt(0).toUpperCase() + item.rarity.slice(1));
    if (item.reqAttune) keywordList.push("Requires Attunement");
    keywords.innerText = keywordList.join(", ");
    doc.characterInventoryDescriptionPanel.appendChild(keywords);

    // create a second entry for the value and weight of the item
    keywords = document.createElement("p");
    keywords.classList.add("characterInventoryDescriptionPanelObject", "characterInventoryDescriptionPanelHeader", "subscript", "italic");
    keywordList = [];
    if (item.value) keywordList.push(`${item.value} GP`);
    if (item.weight) keywordList.push(`${item.weight} lb`);
    keywords.innerText = keywordList.join(", ");
    if (keywordList.length > 0) doc.characterInventoryDescriptionPanel.appendChild(keywords);

    // for every bit of info in the item's description entry, make a tab for it
    extractEntries(item.entries, doc.characterInventoryDescriptionPanel, {
        header: ["characterInventoryDescriptionPanelObject", "characterInventoryDescriptionPanelHeader"],
        content: ["characterInventoryDescriptionPanelProperty"],
        general: ["characterInventoryDescriptionPanelObject"],
        tableHeader: ["characterTableEntry", "characterTableEntryHeader"],
        table: ["characterTableEntry"],
        inset: ["characterInsetHeader"]
    });
}

// populate the character inventory menu with whatever items the selected player currently has
let selectedInventoryItem = null;
function updateInventory(items = []) {
    // first, remove all existing items except for the top element, which acts as a header
    while (doc.characterInventoryMainPanel.children.length > 1) doc.characterInventoryMainPanel.lastChild.remove();

    // this will be changed later if something is selected, but for now assume nothing is
    doc.characterInventoryDescriptionPanelTitle.innerText = "No Items Selected";

    for (let item of items) {
        let selector = document.createElement("div");
        selector.classList.add("characterInventoryMainSelector");
        // if this item is selected, we adjust the secondary menu to show detailed info on it, and highlight it red
        if (selectedInventoryItem === item) {
            selector.classList.add("characterInventoryMainSelectorSelected");
            populateDescriptionPanel(item);
        }

        let icon = document.createElement("p");
        icon.classList.add("emojiFont", "characterInventoryMainSelectorIcon");
        icon.innerText = item.icon ?? "?";
        selector.appendChild(icon);

        let name = document.createElement("p");
        name.classList.add("characterInventoryMainSelectorName");
        name.innerText = item.name;
        selector.appendChild(name);

        let quantity = document.createElement("p");
        quantity.classList.add("characterInventoryMainSelectorQuantity");
        quantity.innerText = item.quantity ?? 1;
        selector.appendChild(quantity);

        let weight = document.createElement("p");
        weight.classList.add("characterInventoryMainSelectorWeight");
        weight.innerText = (item.weight * (item.quantity ?? 1)) >= 1 ? (item.weight * (item.quantity ?? 1)) : "-";
        selector.appendChild(weight);

        // when clicked, make it the selected item
        selector.addEventListener("click", function(e) {
            for (let sel of document.getElementsByClassName("characterInventoryMainSelector")) {
                sel.classList.remove("characterInventoryMainSelectorSelected");
            }
            selector.classList.add("characterInventoryMainSelectorSelected");
            selectedInventoryItem = item;

            populateDescriptionPanel(item);
        });

        selector.addEventListener("contextmenu", function(e) {
            populateRightClick([{
                name: "Open Popup 1",
                function: function() {
                    createPopup("This is a popup", "And an example of the context menu", {type: 0}, "Ok?", function(e){return true});
                }
            }, {
                name: "Open Popup 2",
                function: function() {
                    createPopup("This is the second popup", "And yet another example of the context menu", {type: 0}, "Please Stop", function(e){return true});
                }
            }]);
        });

        doc.characterInventoryMainPanel.appendChild(selector);
    }
}

function createClassDropdowns() {
    // for every class we have, create a dropdown hierarchy
    while (doc.characterClassesClassSubpanel.children.length > 1) doc.characterClassesClassSubpanel.lastChild.remove();
    for (let c of Object.keys(classData)) {
        let data = null;
        for (let version of classData[c].class) {
            if (version.basicRules2024) {
                data = version;
                break;
            }
        }
        if (data === null) continue;

        // first generate a header with the class name
        let tab = document.createElement("div");
        tab.classList.add("characterEquippedClassTab", "characterEquippedClassTabDisabled");
        
        let header = document.createElement("div");
        header.classList.add("characterEquippedClassHeader", "center");
        header.innerText = "○ " + c[0].toUpperCase() + c.substring(1);

        header.addEventListener("click", function() {
            if (tab.classList.contains("characterEquippedClassTabEnabled")) {
                tab.classList.remove("characterEquippedClassTabEnabled");
                tab.classList.add("characterEquippedClassTabDisabled");
                header.innerText = "○" + header.innerText.substring(1);
            } else {
                tab.classList.add("characterEquippedClassTabEnabled");
                tab.classList.remove("characterEquippedClassTabDisabled");
                header.innerText = "●" + header.innerText.substring(1);
            }
        });
        tab.appendChild(header);

        // go through and use the json to create a ton of tabs for every level of the class
        for (let feature of data.classFeatures) {
            if (typeof feature !== "string") continue;
            let subtab = document.createElement("div");
            subtab.classList.add("characterEquippedClassSubTab", "characterEquippedClassTabDisabled");

            let e = document.createElement("div");
            e.classList.add("characterEquippedClassSubHeader", "center");
            e.innerText = "○ " + feature;
            e.addEventListener("click", function() {
                if (subtab.classList.contains("characterEquippedClassTabEnabled")) {
                    subtab.classList.remove("characterEquippedClassTabEnabled");
                    subtab.classList.add("characterEquippedClassTabDisabled");
                    e.innerText = "○" + e.innerText.substring(1);
                } else {
                    subtab.classList.add("characterEquippedClassTabEnabled");
                    subtab.classList.remove("characterEquippedClassTabDisabled");
                    e.innerText = "●" + e.innerText.substring(1);
                }
            });
            subtab.appendChild(e);

            // add all the rules text to the subtab thing, as well as any player input menus
            for (let i of classData[c].classFeature) {
                if (i.name !== feature.split("|")[0] || i.level !== parseInt(feature.split("|")[3]) || !i.basicRules2024) continue;
                extractEntries(i.entries, subtab, {
                    header: ["characterEquippedClassDescription", "characterEquippedClassDescriptionHeader", "center"],
                    content: [],
                    general: ["characterEquippedClassDescription", "center"],
                    tableHeader: ["characterTableEntry", "characterTableEntryHeader"],
                    table: ["characterTableEntry"],
                    inset: ["characterInsetHeader"],
                    dontChangeParent: true
                });
            }

            tab.appendChild(subtab);
        }

        doc.characterClassesClassSubpanel.appendChild(tab);
    }
}

// generates all the menus for the character, filling them in with data matching the sheet
function fillCharacterFields(character) {

    // calculates the characteristics for each base stat from all modifiers
    for (let characteristic of baseCharacteristics) {
        let stat = character.baseCharacteristics[characteristic];

        // update the characteristics menu with the base characteristics
        document.getElementById(`${characteristic}CharacteristicBaseField`).value = character.baseCharacteristics[characteristic];

        // go through and calculate the real values from modifiers
        let charBox = document.getElementById(`${characteristic}ClassesCharacteristicsBox`);
        while (charBox.children.length > 3) charBox.lastChild.remove();
        for (let mod of character.modifiers) {
            if (mod.type !== "characteristic" || mod.target !== characteristic) continue;
            stat += mod.amount;

            // create an input tab for each modifier
            let modifierText = document.createElement("p");
            modifierText.classList.add("characterClassPanelCharacteristicBoxText", "centerFlexAlign");
            modifierText.innerText = mod.name;
            charBox.appendChild(modifierText);
            let modifierTab = document.createElement("input");
            modifierTab.classList.add("characterClassPanelCharacteristicBoxField");
            modifierTab.value = mod.amount;
            modifierTab.addEventListener("contextmenu", function(e) {
                populateRightClick([{
                    name: "Delete Modifier",
                    function: function() {
                        if (!currentSelectedCharacter) return error(0);
                        currentSelectedCharacter.modifiers.splice(currentSelectedCharacter.modifiers.indexOf(mod), 1);
                        fillCharacterFields(currentSelectedCharacter);
                    }
                }]);
            });
            modifierTab.addEventListener("change", function(e) {
                if (!currentSelectedCharacter) return error(0);
                currentSelectedCharacter.modifiers[currentSelectedCharacter.modifiers.indexOf(mod)].amount = parseInt(modifierTab.value);
                fillCharacterFields(currentSelectedCharacter);
            });
            charBox.appendChild(modifierTab);
        }

        // set the characteristics correctly
        character.characteristics[characteristic] = stat;
    }

    // go through every skill and auto-fill it
    for (let skill of Object.keys(skillList)) {
        let holder = document.getElementById(`${skill}ModifierHolder`);
        // run through every proficiency we have to get our prof level
        let profLevel = 0;
        for (let prof of character.proficiencies) {
            if (prof.type !== "skill" || prof.name !== skill) continue;
            if (prof.level === "prof" && profLevel < 3) profLevel = 3;
            if (prof.level === "exp") profLevel = 6;
        }
        switch (profLevel) {
            case 3: {
                holder.classList.add("characterAbilitySidebarHolderProf");
                break;
            }
            case 6: {
                holder.classList.add("characterAbilitySidebarHolderExp");
                break;
            }
        }
        // calculate the stat from our base modifiers
        let stat = modifier(character.characteristics[skillList[skill]]) + profLevel;
        holder.children[1].innerText = (stat >= 0 ? "+" : "") + stat;
    }

    // go through every saving throw and auto fill it
    for (let characteristic of baseCharacteristics) {
        let holder = document.getElementById(`${characteristic}SaveModifierHolder`);
        let profLevel = 0;
        for (let prof of character.proficiencies) {
            if (prof.type !== "save" || prof.name !== characteristic) continue;
            if (prof.level === "prof" && profLevel < 3) profLevel = 3;
            if (prof.level === "exp") profLevel = 6;
        }
        switch (profLevel) {
            case 3: {
                holder.classList.add("characterAbilitySidebarHolderProf");
                break;
            }
            case 6: {
                holder.classList.add("characterAbilitySidebarHolderExp");
                break;
            }
        }
        let stat = modifier(character.characteristics[characteristic]) + profLevel;
        holder.children[1].innerText = (stat >= 0 ? "+" : "") + stat;
    }

    // fill in the base stats
    for (let characteristic of baseCharacteristics) {
        let holder = document.getElementById(`${characteristic}BaseStatModifierHolder`);
        let stat = modifier(character.characteristics[characteristic]);
        holder.children[1].innerText = (stat >= 0 ? "+" : "") + stat;
    }

    // fill in the top bars, like hp and AC
    document.getElementById("characterHealthField").value = character.status.health;
    document.getElementById("characterHealthBottomtext").innerText = `Max: ${character.status.maxHealth}`;

    let hitDiceText = `${character.status.hitDice[0].number ?? "0"}`;
    let hitDiceBottomText = `d${character.status.hitDice[0].faces ?? "d8"}`;
    for (let i = 1; i < character.status.hitDice.length; i++) {
        hitDiceText += ` + ${character.status.hitDice[i].number}`;
        hitDiceBottomText += ` + d${character.status.hitDice[i].faces}`;
    }
    document.getElementById("characterHitdiceField").innerText = hitDiceText;
    document.getElementById("characterHitdiceBottomtext").innerText = hitDiceBottomText;

    document.getElementById("characterACField").innerText = character.status.AC;
    document.getElementById("characterACBottomtext").innerText = `Base: ${character.status.baseAC}`;

    document.getElementById("characterInitiativeField").innerText = ((character.status.initiative > 0) ? "+" : "") + character.status.initiative;
    document.getElementById("characterInitiativeBottomtext").innerText = "Out of Combat";

    let speedText = character.status.walkSpeed + (character.status.flySpeed > 0 ? `/${character.status.flySpeed}` : ``);
    document.getElementById("characterSpeedField").innerText = speedText;
    document.getElementById("characterSpeedBottomtext").innerText = (character.status.flySpeed > 0 ? "Walk/Fly" : "Walking");
    
    document.getElementById("characterProficiencyField").innerText = (character.status.profBonus > 0 ? "+" : "") + character.status.profBonus;
    document.getElementById("characterProficiencyBottomtext").innerText = "Level ??";

    // fills in the character name, owner, and privacy setting
    document.getElementById("characterNameInput").value = character.metadata.characterName;
    document.getElementById("characterOwnerInput").value = character.metadata.ownerName;
    document.getElementById("characterVisibilityInput").value = character.metadata.visibility;
}

// creates a popup menu based on the specifications
export function createPopup(title, description, special, button1, callback1, button2, callback2) {
    doc.popupMenu.classList.remove("hidden");
    doc.popupMenuHeader.innerText = title;
    doc.popupMenuDescription.innerText = description;

    doc.popupMenuInput.classList.add("hidden");
    doc.popupMenuInput.value = "";
    doc.popupMenuSingleButton.classList.add("hidden");
    doc.popupMenuLeftDoubleButton.classList.add("hidden");
    doc.popupMenuRightDoubleButton.classList.add("hidden");
    doc.popupMenuFileDropLabel.classList.add("hidden");

    switch (special.type) {
        // just simple text
        case 0: {
            doc.popupMenuDescription.classList.remove("contractedPopupDescription");
            break;
        }
        // an input
        case 1: {
            doc.popupMenuDescription.classList.add("contractedPopupDescription");
            doc.popupMenuInput.classList.remove("hidden");
            doc.popupMenuInput.placeholder = special.placeholder;
            doc.popupMenuInput.maxLength = special.maxlength;
            break;
        }
        // a file upload
        case 2: {
            doc.popupMenuDescription.classList.add("contractedPopupDescription");
            doc.popupMenuFileDropLabel.classList.remove("hidden");
            doc.popupMenuFileDropLabel.innerText = "Click to Upload a File";
            doc.popupMenuFileDrop.value = "";
            break;
        }
    }

    if (button2) {
        doc.popupMenuLeftDoubleButton.classList.remove("hidden");
        doc.popupMenuRightDoubleButton.classList.remove("hidden");
        doc.popupMenuLeftDoubleButton.innerText = button1;
        doc.popupMenuRightDoubleButton.innerText = button2;
        const btn1Event = function(e) {
            if (callback1(e)) {
                doc.popupMenu.classList.add("hidden");
                doc.popupMenuLeftDoubleButton.removeEventListener("click", btn1Event);
                doc.popupMenuRightDoubleButton.removeEventListener("click", btn2Event);
            }
        }
        const btn2Event = function(e) {
            if (callback2(e)) {
                doc.popupMenu.classList.add("hidden");
                doc.popupMenuLeftDoubleButton.removeEventListener("click", btn1Event);
                doc.popupMenuRightDoubleButton.removeEventListener("click", btn2Event);
            }
        }
        doc.popupMenuLeftDoubleButton.addEventListener("click", btn1Event);
        doc.popupMenuRightDoubleButton.addEventListener("click", btn2Event);
    } else {
        doc.popupMenuSingleButton.classList.remove("hidden");
        doc.popupMenuSingleButton.innerText = button1;
        const btn1Event = function(e) {
            if (callback1(e)) {
                doc.popupMenu.classList.add("hidden");
                doc.popupMenuSingleButton.removeEventListener("click", btn1Event);
            }
        }
        doc.popupMenuSingleButton.addEventListener("click", btn1Event);
    }
}

let character = {
    "backgrounds": [],
    "classes": [],
    "inventory": [],
    "proficiencies": [],
    "feats": [],
    "actions": []
};

let itemData = null;
async function fetchProtocol() {
    itemData = await (await fetch("./json/items.json")).json();
    character.inventory = [];
    for (let item of itemData.item) /*if (item.basicRules2024)*/ character.inventory.push(item);
    updateInventory(character.inventory);
}
await fetchProtocol();

// fetch classes and throw them into an object
async function fetchClass(name, final) {
    let classInfo = await (await fetch(`./json/data/class/class-${name}.json`)).json();
    classData[name] = classInfo;
    if (final) {
        createClassDropdowns();
    }
}
for (let c of classNames) {
    await fetchClass(c, c === classNames[classNames.length - 1]);
}
