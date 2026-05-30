// Uploads API — sends a single image file to /api/uploads/image and
// receives back the absolute URL the backend stored it at (Azure Blob).
// The URL is what gets written to facilities.image_url / floors.layout_image_url.

import api from './client';

export interface UploadResult {
  url: string;
  blob_name: string;
  container: string;
  size: number;
  content_type: string;
}

export const uploadsApi = {
  /**
   * Upload a single image. `category` becomes the folder prefix inside
   * the blob container so we can tell facility covers from floor maps
   * at a glance.
   */
  image(file: File, category: 'facility-images' | 'floor-maps' | 'other' = 'facility-images') {
    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('category', category);
    return api
      .post<{ status: boolean; msg?: string; data?: UploadResult }>('/uploads/image', fd, {
        // axios sets the multipart boundary automatically — just need to
        // *not* override Content-Type with application/json.
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
};
