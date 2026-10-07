import Lenis from "lenis";
import { useEffect } from "react";
import { AssemblyLine } from "./components/AssemblyLine";
import { Features, Marquee } from "./components/Features";
import { Footer, GetStarted } from "./components/GetStarted";
import { Hero } from "./components/Hero";
import { LiveRun } from "./components/LiveRun";
import { Nav } from "./components/Nav";
import { Recipes } from "./components/Recipes";
import { Review } from "./components/Review";
import { Today } from "./components/Today";

export function App() {
	useEffect(() => {
		if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const lenis = new Lenis({ anchors: true, lerp: 0.11 });
		let frame = requestAnimationFrame(function loop(time) {
			lenis.raf(time);
			frame = requestAnimationFrame(loop);
		});
		return () => {
			cancelAnimationFrame(frame);
			lenis.destroy();
		};
	}, []);
	return (
		<div id="top">
			<Nav />
			<main>
				<Hero />
				<Marquee />
				<AssemblyLine />
				<LiveRun />
				<Review />
				<Today />
				<Recipes />
				<Features />
				<GetStarted />
			</main>
			<Footer />
		</div>
	);
}
