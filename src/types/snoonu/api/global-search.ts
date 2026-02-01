import type {
	ApiResponse,
	BaseProduct,
	MerchantStatus,
	SubscriptionBenefits,
} from "./base";

/** GET https://admin.snoonu.com/api/v5/search/global */
export interface GlobalSearchRequest {
	page: number;
	page_size: number;
	product_size: number;
	term: string;
	category_id?: number;
}

export type GlobalSearchResponse = ApiResponse<GlobalSearchData>;

export interface GlobalSearchData {
	merchants: GlobalSearchMerchant[];
	analytics: {
		query_id: string;
	};
	tag_filters: TagFilter[];
}

export interface TagFilter {
	id: string;
	name: string;
	count: number;
}

export interface GlobalSearchMerchant {
	name: string;
	english_name: string;
	id: number;
	image_url: string;
	time_value: string;
	time_unit: "mins" | string;
	min_eta: number;
	status_merchant: MerchantStatus | string;
	info_merchant: MerchantInfo;
	product_view: "list" | "Grid" | string;
	brand_id: string;
	main_category_id: string;
	menu_id: number;
	has_inventory: boolean;
	has_more_item: boolean;
	is_food_merchant: boolean;
	tag: string[];
	branch_id: string;
	distance: number;
	average_preparation_time: number;
	products: GlobalSearchProduct[];
	url_friendly_name: string;
	promotions: Promotion[];
	rating: number;
	support_order_schedule: boolean;
	algolia_object_id: string;
	ad_campaign_id: string | null;
	bid_id: string | null;
	is_promoted: boolean;
	subscription_benefits: SubscriptionBenefits;
	delivery_method: number;
	vertical: number;
}

export interface MerchantInfo {
	status: string;
	time: string;
	title: string;
	message: string;
	is_always_available: boolean;
}

export interface Promotion {
	kind: number;
	value: string;
}

export interface GlobalSearchProduct extends BaseProduct {}
