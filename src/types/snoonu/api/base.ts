/** Base API response wrapper used by all Snoonu APIs */
export interface ApiResponse<T> {
	status: "SUCCESS" | "ERROR";
	message: string | null;
	error: ApiError | null;
	data: T;
	is_success: boolean;
}

export interface ApiError {
	code: string;
	message: string;
}

/** Common product fields shared across APIs */
export interface BaseProduct {
	merchant_id: number;
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
	price_old: string | null;
	min_price: number;
	base_price: number;
	market_place_price: number;
	market_place_discount: number;
	price_without_discount: number;
	discount_percentage: number | null;
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
	relevance_score: number | null;
	product_order_limit: number;
	additional_data: AdditionalDataGroup[];
	is_available: boolean;
	vertical: number;
	marketplace_main_categories: string[];
	marketplace_sub_categories: string[];
	marketplace_product_groups: string[];
	url_friendly_name: string | null;
	product_tags: ProductTags;
	rating_info: RatingInfo | null;
	food_item_rating: FoodItemRating | null;
}

export interface AdditionalDataGroup {
	id: string;
	name: string;
	english_name: string;
	name_ar: string | null;
	view_type: number;
	mode: number;
	min: number;
	max: number;
	is_same_image: boolean;
	data: AdditionalDataOption[];
}

export interface AdditionalDataOption {
	id: number;
	additional_option_id: string;
	name: string;
	english_name: string;
	name_ar: string | null;
	price: string;
	is_default: boolean;
	group_id: string;
	image: string;
	main_image: string;
	is_available: boolean;
	price_raw: number;
}

export interface ProductTags {
	SPlusFreeDelivery?: ProductTag;
	"By Snoonu"?: ProductTag;
	Promo?: ProductTag;
	Discount?: ProductTag;
}

export interface ProductTag {
	priority: number;
	locales: {
		en: { title: string };
		ar: { title: string };
	};
}

export interface RatingInfo {
	rating: number;
	rating_count: number;
	rating_stars: number;
}

export interface FoodItemRating {
	rating: number;
	rating_count: number;
}

export interface SubscriptionBenefits {
	s_plus: {
		is_free_delivery_eligible: boolean;
	};
}

export type MerchantStatus = "open" | "closed" | "busy" | "one_hour_left" | "available_for_scheduled_delivery";
