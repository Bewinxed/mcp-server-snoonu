export interface SyncCartRequest {
	items: Item[];
}

export interface Item {
	product_identity: ProductIdentity;
	quantity: number;
}

export interface ProductIdentity {
	product_id: string;
	choice_item_ids: any[];
	special_request: string;
}
