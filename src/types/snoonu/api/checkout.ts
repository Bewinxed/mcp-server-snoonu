import type { ApiResponse } from "./base";

/** Checkout page data types */

export interface CheckoutAddress {
	id: string;
	name: string; // e.g., "Home", "Work"
	full_address: string;
	building_number?: string;
	floor?: string;
	apartment?: string;
	notes?: string;
	latitude: number;
	longitude: number;
	is_default: boolean;
}

export interface PaymentMethod {
	type: PaymentMethodType;
	card_last_four?: string;
	card_brand?: string; // e.g., "visa", "mastercard"
	is_default?: boolean;
}

export type PaymentMethodType =
	| "saved_card"
	| "google_pay"
	| "apple_pay"
	| "debit_card"
	| "cash"
	| "new_card";

export interface CheckoutOrderSummary {
	merchant_name: string;
	merchant_id: number;
	delivery_estimate: string; // e.g., "Today, within 40 min"
	items: CheckoutItem[];
	items_total: number;
	delivery_fee: number;
	discount?: number;
	voucher_discount?: number;
	total: number;
}

export interface CheckoutItem {
	product_id: string;
	name: string;
	image_url: string;
	quantity: number;
	price: number;
	total_price: number;
}

/** POST https://admin.snoonu.com/api/v5/orders/place (or similar) */
export interface PlaceOrderRequest {
	address_id: string;
	payment_method: PaymentMethodType;
	card_id?: string; // For saved cards
	voucher_code?: string;
	tip_amount?: number;
	notes?: string;
}

export type PlaceOrderResponse = ApiResponse<PlaceOrderData>;

export interface PlaceOrderData {
	order_id: string;
	order_number: string;
	status: string;
	estimated_delivery: string;
	total_amount: number;
}
