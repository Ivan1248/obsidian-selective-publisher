declare module '@electron/remote' {
	interface OpenDialogOptions {
		properties?: Array<'openDirectory' | 'openFile' | 'multiSelections'>;
		defaultPath?: string;
	}

	interface OpenDialogReturnValue {
		canceled: boolean;
		filePaths: string[];
	}

	export const dialog: {
		showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue>;
	};
}
