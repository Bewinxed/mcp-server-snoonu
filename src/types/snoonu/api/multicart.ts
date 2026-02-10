import type { ApiResponse } from "./base";

/** POST https://snoomarket-web.snoonu.com/api/v1/multicart/sync */
export interface MulticartSyncRequest {
	items: MulticartSyncItem[];
}

export interface MulticartSyncItem {
	product_identity: ProductIdentity;
	quantity: number;
}

export interface ProductIdentity {
	product_id: string;
	choice_item_ids: string[];
	special_request: string;
}

export type MulticartSyncResponse = ApiResponse<MulticartSyncData>;

export interface MulticartSyncData {
	total_quantity: number;
	full_cart_price: number;
	items: CartItem[];
	cart_id: string | null;
}

/** Response item from multicart/sync — nested product_identity, not flat. */
export interface CartItem {
	product_identity: ProductIdentity;
	quantity: number;
	is_buy_later: boolean;
	/** Convenience alias used in api-client mapping */
	product_id?: string;
}
