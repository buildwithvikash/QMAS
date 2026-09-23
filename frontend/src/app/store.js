import { configureStore } from '@reduxjs/toolkit';
import { baseApi } from '../api/baseApi.js';
import authReducer from './authSlice.js';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    [baseApi.reducerPath]: baseApi.reducer,
  },
  middleware: (getDefault) => getDefault().concat(baseApi.middleware),
});
