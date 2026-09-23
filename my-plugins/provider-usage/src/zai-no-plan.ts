import { isJsonRecord } from "./json-record.js";

export function isZaiNoPlanResponse(value: unknown): boolean {
	return isJsonRecord(value) && value.success === false && value.code === 500 &&
		typeof value.msg === "string" && value.msg.trim() === "当前用户不存在coding plan";
}

export function isEmptyZaiSubscription(value: unknown): boolean {
	return isJsonRecord(value) && value.success === true && value.code === 200 &&
		Array.isArray(value.data) && value.data.length === 0;
}
