import { handleBackgroundRequest } from '../../api/function.mjs';

export default async function nativeApiBackground(request, context) {
  return handleBackgroundRequest(request, context);
}
