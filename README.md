# BrandSparQ

Mobile-first Expo web/mobile app for turning raw brand images into strategic social content, routing it through review and approval, placing approved posts on a multi-client marketing calendar, and publishing through connected social platforms.

## Core flow
Images → AI analysis → graphics/captions → strategic slot suggestion → review/edit/approve → calendar → pre-publish alert → keep / reschedule / publish now → publish → analytics.

## Stack
Expo + React Native + Expo Router + TypeScript; Cloudflare Workers, D1, R2 and Queues.

## Local start
1. npm install
2. Copy .env.example to .env
3. npm start
4. npm run web

The scaffold currently uses demo data while backend and social integrations are wired.
