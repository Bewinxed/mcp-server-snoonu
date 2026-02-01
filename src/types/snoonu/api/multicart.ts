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

export interface CartItem {
	product_id: string;
	merchant_id: number;
	name: string;
	english_name: string;
	image_url: string;
	price: number;
	quantity: number;
	total_price: number;
	choice_items: ChoiceItem[];
	special_request: string;
	is_available: boolean;
	is_instock: boolean;
}

export interface ChoiceItem {
	id: string;
	name: string;
	price: number;
}
