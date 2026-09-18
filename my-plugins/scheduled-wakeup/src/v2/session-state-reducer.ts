import {
	cloneRegistration,
	cloneSessionState,
	cloneSessionTask,
	type ExecutionProgress,
	type Registration,
	type SessionLoopState,
	type SessionTask,
} from "./model.js";

export type SessionStateAction =
	| { kind: "add-task"; task: SessionTask }
	| { kind: "remove-task"; taskId: string }
	| { kind: "advance-task"; taskId: string; progress: ExecutionProgress }
	| { kind: "add-registration"; registration: Registration }
	| { kind: "remove-registration"; registrationId: string }
	| { kind: "advance-registration"; registrationId: string; progress: ExecutionProgress };

export function emptySessionLoopState(): SessionLoopState {
	return { version: 1, tasks: [], registrations: [] };
}

export function reduceSessionLoopState(state: SessionLoopState, action: SessionStateAction): SessionLoopState {
	switch (action.kind) {
		case "add-task":
			if (state.tasks.some((task) => task.definition.id === action.task.definition.id)) {
				throw new Error(`Session task ${action.task.definition.id} already exists`);
			}
			return { ...cloneSessionState(state), tasks: [...state.tasks.map(cloneSessionTask), cloneSessionTask(action.task)] };
		case "remove-task":
			return { ...cloneSessionState(state), tasks: state.tasks.filter((task) => task.definition.id !== action.taskId).map(cloneSessionTask) };
		case "advance-task":
			return advanceTask(state, action.taskId, action.progress);
		case "add-registration":
			if (state.registrations.some((registration) => registration.id === action.registration.id)) {
				throw new Error(`Registration ${action.registration.id} already exists`);
			}
			return {
				...cloneSessionState(state),
				registrations: [...state.registrations.map(cloneRegistration), cloneRegistration(action.registration)],
			};
		case "remove-registration":
			return {
				...cloneSessionState(state),
				registrations: state.registrations.filter((registration) => registration.id !== action.registrationId).map(cloneRegistration),
			};
		case "advance-registration":
			return advanceRegistration(state, action.registrationId, action.progress);
		default:
			return cloneSessionState(state);
	}
}

function advanceTask(state: SessionLoopState, taskId: string, progress: ExecutionProgress): SessionLoopState {
	let found = false;
	const tasks = state.tasks.map((task) => {
		if (task.definition.id !== taskId) return cloneSessionTask(task);
		found = true;
		return { definition: cloneSessionTask(task).definition, progress: { ...progress } };
	});
	if (!found) throw new Error(`Session task ${taskId} does not exist`);
	return { version: 1, tasks, registrations: state.registrations.map(cloneRegistration) };
}

function advanceRegistration(state: SessionLoopState, registrationId: string, progress: ExecutionProgress): SessionLoopState {
	let found = false;
	const registrations = state.registrations.map((registration) => {
		if (registration.id !== registrationId) return cloneRegistration(registration);
		found = true;
		return { ...cloneRegistration(registration), progress: { ...progress } };
	});
	if (!found) throw new Error(`Registration ${registrationId} does not exist`);
	return { version: 1, tasks: state.tasks.map(cloneSessionTask), registrations };
}
