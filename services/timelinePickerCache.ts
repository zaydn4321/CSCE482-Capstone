/** Allow deletion only for direct JSON files copied into Expo DocumentPicker's private cache directory. */
export function isTimelinePickerCacheJsonUri(uri: string, pickerDirectoryUri: string): boolean {
  const root = pickerDirectoryUri.replace(/\/+$/, '');
  const relativePath = uri.startsWith(`${root}/`) ? uri.slice(root.length + 1) : '';
  return relativePath.length > 0 && !relativePath.includes('/') && relativePath.toLowerCase().endsWith('.json');
}