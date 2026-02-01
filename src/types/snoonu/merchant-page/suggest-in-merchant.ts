export interface SuggestInMerchantRequest {
	term: string;
	language: string;
	menu_id: number;
}

export interface SuggestInMerchantResponse {
	status: string;
	message: null;
	error: null;
	data: Data;
	is_success: boolean;
}

export interface Data {
	product_view_models: ProductViewModel[];
	sub_categories: any[];
}

export interface ProductViewModel {
	brand_id: number;
	merchant_name: string;
	merchant_english_name: null;
	merchant_status: "open" | null;
	merchant_id: number;
	business_unit_id: string;
	is_food_merchant: boolean;
	branch_id: null;
	name: string;
	english_name: string;
	id: number;
	object_id: string;
	query_id: string | null;
	product_id: string;
	business_unit_main_category_id: string;
	image_url: string;
	images: string[];
	price: string;
	price_old: null;
	min_price: number;
	base_price: number;
	market_place_price: number;
	market_place_discount: number;
	web_non_auth_price: null;
	description: string | null;
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
	url_friendly_name: string | null;
	product_tags: ProductTags;
	rating_info: null;
	food_item_rating: null;
}

export interface ProductTags {}
