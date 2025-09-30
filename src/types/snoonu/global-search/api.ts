export interface GlobalSearchApiResponse {
	status: string;
	message: null;
	error: null;
	data: GlobalSearchApiData;
	is_success: boolean;
}

export interface GlobalSearchApiData {
	merchants: Merchant[];
	analytics: Analytics;
	tag_filters: any[];
}

export interface Analytics {
	query_id: string;
}

export interface Merchant {
	name: string;
	english_name: string;
	id: number;
	image_url: string;
	time_value: string;
	time_unit: "mins";
	min_eta: number;
	status_merchant: StatusMerchant;
	info_merchant: InfoMerchant;
	product_view: ProductView;
	brand_id: string;
	main_category_id: "61820a73c77f5ff17a305bb5";
	menu_id: number;
	has_inventory: boolean;
	has_more_item: boolean;
	is_food_merchant: boolean;
	tag: string[];
	branch_id: string;
	distance: number;
	average_preparation_time: number;
	products: Product[];
	url_friendly_name: string;
	promotions: Promotion[];
	rating: number;
	support_order_schedule: boolean;
	algolia_object_id: string;
	ad_campaign_id: null;
	bid_id: null;
	is_promoted: boolean;
	subscription_benefits: SubscriptionBenefits;
}

export interface InfoMerchant {
	status: Status;
	time: string;
	title: Title;
	message: string;
	is_always_available: boolean;
}

export enum Status {
	Closed = "Closed",
	Open = "Open",
}

export enum Title {
	ClosedUntil900AM = "Closed Until 9:00 AM",
	Empty = "",
}

export enum ProductView {
	List = "list",
	SubCategoryView = "subCategoryView",
}

export interface Product {
	merchant_id: number;
	name: string;
	english_name: string;
	id: number;
	object_id: string;
	query_id: null;
	product_id: string;
	business_unit_main_category_id: string;
	image_url: string;
	images: string[];
	price: string;
	price_old: null | string;
	min_price: number;
	base_price: number;
	market_place_price: number;
	market_place_discount: number;
	web_non_auth_price: null;
	description: null;
	is_instock: boolean;
	discount: number;
	not_rounded_discount: number;
	ignore_promoted: boolean;
	stock_count: number;
	is_low_stock: boolean;
	promoted: number;
	has_buy_one_get_one: boolean;
	additional_required: number;
	relevance_score: null;
	product_order_limit: number;
	additional_data: any[];
	is_available: boolean;
	vertical: number;
	marketplace_main_categories: any[];
	marketplace_sub_categories: any[];
	marketplace_product_groups: any[];
	url_friendly_name: string;
	product_tags: ProductTags;
	rating_info: null;
	food_item_rating: null;
}

export interface ProductTags {}

export interface Promotion {
	kind: number;
	value: string;
}

export enum StatusMerchant {
	AvailableForScheduledDelivery = "available_for_scheduled_delivery",
	Open = "open",
}

export interface SubscriptionBenefits {
	s_plus: SPlus;
}

export interface SPlus {
	is_free_delivery_eligible: boolean;
}
