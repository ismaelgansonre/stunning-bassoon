/**
 * Modified version of https://github.com/editor-js/image/blob/master/src/uploader.js
 */
export default class Uploader {
	constructor({ config, getCurrentFile, onUpload, onError, api }) {
		this.getCurrentFile = getCurrentFile;
		this.config = config;
		this.onUpload = onUpload;
		this.onError = onError;
		this.api = api; // Axios instance
	}

	uploadByFile(file, { onPreview }) {
		// Upload file directly via Directus API
		this.uploadFileDirectly(file, { onPreview });
	}

	uploadFileDirectly(file, { onPreview }) {
		// Create FormData and upload directly to Directus using Axios
		const formData = new FormData();
		formData.append('file', file);

		if (this.config.uploader.folder) {
			formData.append('folder', this.config.uploader.folder);
		}

		onPreview();

		// Use Axios API for authenticated upload
		this.api
			.post('files', formData, {
				headers: {
					'Content-Type': 'multipart/form-data',
				},
			})
			.then((response) => {
				if (!response.data?.data) {
					throw new Error('No file data returned');
				}

				const fileData = response.data.data;
				const responseData = {
					success: 1,
					file: {
						width: fileData.width,
						height: fileData.height,
						size: fileData.filesize,
						name: fileData.filename_download,
						title: fileData.title || fileData.filename_download,
						extension: fileData.filename_download.split('.').pop(),
						fileId: fileData.id,
						fileURL: this.config.uploader.baseURL + 'files/' + fileData.id,
						url: this.config.uploader.baseURL + 'assets/' + fileData.id,
					},
				};

				onPreview(
					this.config.uploader.addTokenToURL(responseData.file.url) + '&key=system-large-contain'
				);
				this.onUpload(responseData);
			})
			.catch((error) => {
				const errorMessage =
					error.response?.data?.errors?.[0]?.message || error.message || 'Unknown error';
				window.console.error('editorjs-interface: Upload failed - %s', errorMessage);
				this.onError({
					success: 0,
					message: 'Upload failed: ' + errorMessage,
				});
			});
	}

	uploadByUrl(url) {
		this.onUpload({
			success: 1,
			file: {
				url: url,
			},
		});
	}

	uploadSelectedFile({ onPreview }) {
		if (this.getCurrentFile) {
			const currentPreview = this.getCurrentFile();
			if (currentPreview) {
				this.config.uploader.setCurrentPreview(
					this.config.uploader.addTokenToURL(currentPreview) + '&key=system-large-contain'
				);
			}
		}

		this.config.uploader.setFileHandler((file) => {
			if (!file) {
				this.onError({
					success: 0,
					message: this.config.t.no_file_selected,
				});
				return;
			}

			const response = {
				success: 1,
				file: {
					width: file.width,
					height: file.height,
					size: file.filesize,
					name: file.filename_download,
					title: file.title,
					extension: file.filename_download.split('.').pop(),
					fileId: file.id,
					fileURL: this.config.uploader.baseURL + 'files/' + file.id,
					url: this.config.uploader.baseURL + 'assets/' + file.id,
				},
			};

			onPreview(this.config.uploader.addTokenToURL(response.file.fileURL));
			this.onUpload(response);
		});
	}
}
