export const doc = {
    frontPageSubmitButton: document.getElementById("frontPageSubmitButton"),
    frontMenuCodeInput: document.getElementById("frontMenuCodeInput"),
    tableViewContainer: document.getElementById("tableViewContainer"),
    frontMenuContainer: document.getElementById("frontMenuContainer"),
    contextMenu: document.getElementById("contextMenu"),
    characterInventoryMainPanel: document.getElementById("characterInventoryMainPanel"),
    characterInventoryDescriptionPanel: document.getElementById("characterInventoryDescriptionPanel"),
    characterInventoryDescriptionPanelTitle: document.getElementById("characterInventoryDescriptionPanelTitle"),
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
}
// if the user clicks anywhere outside the select box, then close all select boxes:
document.addEventListener("click", closeAllSelect);

//_ Document event listeners

// the right click event, which opens the context menu on an item if applicable, or otherwise starts an event
document.addEventListener("contextmenu", function(e) {
    doc.contextMenu.style.left = `${e.clientX}px`;
    doc.contextMenu.style.top = `${e.clientY}px`;
    doc.contextMenu.classList.remove("hidden");
});

// if the context menu is moved off of, it is hidden
doc.contextMenu.addEventListener("mouseleave", function(e) {
    doc.contextMenu.classList.add("hidden");
});

// when a section tab is pressed in the character creation menu, hide all other pages
let characterSubsectionTabs = document.getElementsByClassName("characterSubsectionTab");
for (let tab of characterSubsectionTabs) tab.addEventListener("click", function(e) {
    for (let t of characterSubsectionTabs) t.classList.remove("selectedSubsectionTab");
    e.target.classList.add("selectedSubsectionTab");
});

// extracts the entries and creates text objects for them
function extractEntries(entries, parent, depth = 0) {
    for (let entry of entries) {
        // create a header element if the entry has one
        if (entry.name) {
            let header = document.createElement("p");
            header.classList.add("characterInventoryDescriptionPanelObject", "characterInventoryDescriptionPanelHeader");
            header.innerText = entry.name;
            parent.appendChild(header);
        }

        let e = document.createElement("p");
        e.classList.add("characterInventoryDescriptionPanelObject");
        if (depth === 0) e.classList.add("characterInventoryDescriptionPanelProperty");
        // check what type the entry is, or show it as text by default
        switch (entry.type) {
            case "entries": {
                extractEntries(entry.entries, e, depth + 1);
                break;
            }
            case "list": {
                break;
            }
            case "table": {
                break;
            }
            default: {
                e.innerText = entry;
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
    extractEntries(item.entries, doc.characterInventoryDescriptionPanel);

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

        doc.characterInventoryMainPanel.appendChild(selector);
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
    for (let item of itemData.item) if (item.basicRules2024) character.inventory.push(item);
    updateInventory(character.inventory);
}
await fetchProtocol();