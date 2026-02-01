import type { ApiResponse } from "./base";

/** GET https://admin.snoonu.com/api/v5/orders/open */
export type OpenOrdersResponse = ApiResponse<OpenOrdersData>;

export interface OpenOrdersData {
	orders: Order[];
}

export interface Order {
	id: number;
	order_number: string;
	status: OrderStatus;
	merchant_name: string;
	merchant_image_url: string;
	total_price: number;
	delivery_fee: number;
	created_at: string;
	estimated_delivery_time: string;
	items: OrderItem[];
	delivery_address: DeliveryAddress;
	payment_method: string;
	driver_info: DriverInfo | null;
}

export type OrderStatus =
	| "pending"
	| "accepted"
	| "preparing"
	| "ready_for_pickup"
	| "picked_up"
	| "on_the_way"
	| "delivered"
	| "cancelled";

export interface OrderItem {
	id: number;
	name: string;
	quantity: number;
	price: number;
	image_url: string;
	special_request: string | null;
}

export interface DeliveryAddress {
	id: number;
	name: string;
	address: string;
	latitude: number;
	longitude: number;
	building_number: string;
	apartment: string;
	notes: string;
}

export interface DriverInfo {
	name: string;
	phone: string;
	image_url: string;
	vehicle_type: string;
	vehicle_number: string;
}
