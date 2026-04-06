/**
 * Cross-plugin communication protocol for the docker sidebar.
 *
 * Other plugins emit events on the shared EventBus (`pi.events`):
 *   "docker:update"  -> DockerSection   (upsert a section)
 *   "docker:remove"  -> DockerRemove    (remove a section)
 *   "docker:clear"   -> undefined       (remove all sections)
 */

export interface DockerSection {
	id: string;
	title: string;
	/** Lower = higher on screen. */
	order: number;
	/** Content lines. Each line must fit within the overlay width. */
	lines: string[];
}

export interface DockerRemove {
	id: string;
}

export const DOCKER_UPDATE = "docker:update";
export const DOCKER_REMOVE = "docker:remove";
export const DOCKER_CLEAR = "docker:clear";

const DOCKER_FLAG = "__docker_available__";

/** Called by docker extension at init to signal presence. */
export function markDockerAvailable(): void {
	(globalThis as Record<string, unknown>)[DOCKER_FLAG] = true;
}

/** Check if docker extension is loaded. Safe to call at any time. */
export function isDockerAvailable(): boolean {
	return (globalThis as Record<string, unknown>)[DOCKER_FLAG] === true;
}
