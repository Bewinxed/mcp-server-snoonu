export interface MerchantSuggestApiResponse {
	data: MerchantSuggestionData[];
}

export interface MerchantSuggestionData {
	brand_id: number;
	merchant_name: string;
	merchant_english_name: string;
	merchant_status: string;
	merchant_id: number;
	business_unit_id: string;
	is_food_merchant: boolean;
	branch_id: string;
	name: string;
	english_name: string;
	id: number;
	object_id: string;
	query_id: string;
	product_id: string;
	business_unit_main_category_id: string;
	image_url: string;
	images: string[];
	price: string;
	price_old: string;
	min_price: number;
	base_price: number;
	market_place_price: number;
	market_place_discount: number;
	web_non_auth_price: null;
	description: string;
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
	marketplace_main_categories: string[];
	marketplace_sub_categories: string[];
	marketplace_product_groups: string[];
	url_friendly_name: null;
	product_tags: ProductTags;
	rating_info: null;
	food_item_rating: null;
}

export interface ProductTags {}
