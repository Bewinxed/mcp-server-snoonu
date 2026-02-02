<script lang="ts">
	import "../app.css";

	let { children } = $props();
</script>

<svelte:head>
	<title>Snoonu Shopping Agent</title>
	<meta name="description" content="AI-powered shopping assistant for Snoonu" />
</svelte:head>

{@render children()}
