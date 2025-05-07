interface Channel {
    r: number;
    g: number;
    b: number;
    a: number;
    offset: number;
}

export interface Filter {
    red: Channel;
    green: Channel;
    blue: Channel;
    alpha: Channel;
}

export enum WorkType {
    CreateImageData = 1,
    CreateFilter = 2,
    Unknown = 3,
    ApplyFilter = 4,
} 

export interface CreateImageBitmapRequest {
    type: WorkType.CreateImageData;
    bitmap: ImageBitmap;
}

export interface CreateFilterReqeuest {
    type: WorkType.CreateFilter;
    bitmap: ImageBitmap;
}

export interface ApplyFilterRequest {
    type: WorkType.ApplyFilter;
    bitmap: ImageBitmap;
    filter: string; // JSON string of Filter.
}

export interface UnknownResult {
    type: WorkType.Unknown;
    message: string;
}

export type CreateImageBitmapResult = CreateImageBitmapSuccessResult | CreateImageBitmapFailureResult;

export enum CreateImageBitmapResults {
    Failure = 1,
    Success = 2,
}

export interface CreateImageBitmapSuccessResult {
    type: WorkType.CreateImageData;
    result: CreateImageBitmapResults.Success
    imageData: ImageData;
}

export interface CreateImageBitmapFailureResult {
    type: WorkType.CreateImageData;
    result: CreateImageBitmapResults.Failure
    reason: string;
}

export type CreateFilterResult = CreateFilterSuccessResult;

export enum CreateFilterResults {
    Failure = 1,
    Success = 2,
}

export interface CreateFilterSuccessResult {
    type: WorkType.CreateFilter;
    result: CreateFilterResults.Success;
    filter: Filter;
}

export type ApplyFilterResult = ApplyFilteSuccessResult;

export enum ApplyFilterResults {
    Failure = 1,
    Success = 2,
}

export interface ApplyFilteSuccessResult {
    type: WorkType.ApplyFilter;
    result: ApplyFilterResults.Success;
    imageData: ImageData;
}

export type WorkResult = CreateImageBitmapResult | CreateFilterResult | UnknownResult | ApplyFilteSuccessResult;
export type WorkRequest = CreateImageBitmapRequest | CreateFilterReqeuest | ApplyFilterRequest;