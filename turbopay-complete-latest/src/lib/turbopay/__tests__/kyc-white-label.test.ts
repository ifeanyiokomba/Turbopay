import { describe, it, expect } from "vitest";
import { getKycProvider, usesPaystackIdentity, usesStripeIdentity } from "@/lib/turbocore/config/kyc-routing";

describe("KYC provider routing", () => {
  it("routes NG to paystack", () => {
    expect(getKycProvider("NG")).toBe("paystack");
  });

  it("routes GH to paystack", () => {
    expect(getKycProvider("GH")).toBe("paystack");
  });

  it("routes US to stripe", () => {
    expect(getKycProvider("US")).toBe("stripe");
  });

  it("routes GB to stripe", () => {
    expect(getKycProvider("GB")).toBe("stripe");
  });

  it("routes KE to stripe", () => {
    expect(getKycProvider("KE")).toBe("stripe");
  });

  it("routes unknown countries to stripe", () => {
    expect(getKycProvider("XX")).toBe("stripe");
  });

  it("is case-insensitive", () => {
    expect(getKycProvider("ng")).toBe("paystack");
    expect(getKycProvider("us")).toBe("stripe");
  });

  it("usesPaystackIdentity returns true for NG/GH", () => {
    expect(usesPaystackIdentity("NG")).toBe(true);
    expect(usesPaystackIdentity("GH")).toBe(true);
  });

  it("usesPaystackIdentity returns false for other countries", () => {
    expect(usesPaystackIdentity("US")).toBe(false);
    expect(usesPaystackIdentity("GB")).toBe(false);
  });

  it("usesStripeIdentity returns true for non-NG/GH", () => {
    expect(usesStripeIdentity("US")).toBe(true);
    expect(usesStripeIdentity("GB")).toBe(true);
    expect(usesStripeIdentity("KE")).toBe(true);
  });

  it("usesStripeIdentity returns false for NG/GH", () => {
    expect(usesStripeIdentity("NG")).toBe(false);
    expect(usesStripeIdentity("GH")).toBe(false);
  });
});

describe("Mock KYC provider verifyIdentity", () => {
  it("returns correct shape for any document type", async () => {
    const { MockKYCProvider } = await import("@/lib/turbocore/providers/mock");
    const mock = new MockKYCProvider();
    const result = await mock.verifyIdentity({
      country: "US",
      documentType: "passport",
      documentValue: "AB1234567",
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.data) {
      expect(result.data.verified).toBe(true);
      expect(result.data.firstName).toBeTruthy();
      expect(result.data.lastName).toBeTruthy();
      expect(result.data.dob).toBeTruthy();
      expect(result.data.providerRef).toContain("passport");
    }
  });

  it("returns verified for short document values", async () => {
    const { MockKYCProvider } = await import("@/lib/turbocore/providers/mock");
    const mock = new MockKYCProvider();
    const result = await mock.verifyIdentity({
      country: "NG",
      documentType: "nin",
      documentValue: "12345",
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.data) {
      expect(result.data.verified).toBe(false); // < 6 chars
    }
  });
});
