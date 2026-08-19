const form = document.getElementById("item-form");
const list = document.getElementById("item-list");

// Fetch and render items on page load
async function loadItems() {
    const res = await fetch("/items/");
    const items = await res.json();

    list.innerHTML = "";
    items.forEach(renderItem);
}

function renderItem(item) {
    const li = document.createElement("li");
    li.innerHTML = `
        <span>${item.name}</span>
        <span class="price">$${item.price.toFixed(2)}</span>
    `;
    list.appendChild(li);
}

// Handle form submission
form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("name").value;
    const price = parseFloat(document.getElementById("price").value);

    const res = await fetch("/items/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, price })
    });

    if (res.ok) {
        const newItem = await res.json();
        renderItem(newItem);
        form.reset();
    } else {
        alert("Failed to add item");
    }
});

loadItems();
