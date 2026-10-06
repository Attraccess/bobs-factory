export const menu = [
	{
		id: "classic",
		name: "The Classic",
		emoji: "🥞",
		price: 8.5,
		tag: "Bestseller",
		note: "Buttermilk stack, salted butter, maple syrup.",
	},
	{
		id: "berry",
		name: "Berry Avalanche",
		emoji: "🫐",
		price: 11,
		tag: "New",
		note: "Blueberry compote, lemon curd, crème fraîche.",
	},
	{
		id: "choco",
		name: "Midnight Cocoa",
		emoji: "🍫",
		price: 10.5,
		tag: "",
		note: "Dark chocolate batter, hazelnut crunch.",
	},
	{
		id: "banana",
		name: "Banana Bread",
		emoji: "🍌",
		price: 9.5,
		tag: "",
		note: "Caramelised banana, cinnamon, brown butter.",
	},
	{
		id: "savory",
		name: "Sunny Side Stack",
		emoji: "🍳",
		price: 12,
		tag: "Savory",
		note: "Fried egg, crispy bacon, chilli honey.",
	},
	{
		id: "matcha",
		name: "Matcha Cloud",
		emoji: "🍵",
		price: 11.5,
		tag: "Vegan",
		note: "Oat milk soufflé, white sesame, yuzu.",
	},
];

const price = (value) => `€${value.toFixed(2)}`;

export function renderMenu(root) {
	root.innerHTML = menu
		.map(
			(item) => `
		<article class="card">
			<div class="art">${item.emoji}</div>
			${item.tag ? `<span class="tag">${item.tag}</span>` : ""}
			<h2>${item.name}</h2>
			<p>${item.note}</p>
			<footer><b>${price(item.price)}</b><button data-add="${item.id}">Add</button></footer>
		</article>`,
		)
		.join("");
}

renderMenu(document.querySelector("[data-menu]"));
