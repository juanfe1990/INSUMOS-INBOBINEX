import { AboutSection } from '@/components/about-section';
import { ContactSection } from '@/components/contact-section';
import { FeaturesStrip } from '@/components/features-strip';
import { HeroSection } from '@/components/hero-section';
import { ProductsSection } from '@/components/products-section';
import SocialButtons from '@/components/socialButtons';

export default function HomePage() {
    return (
        <div>
            <HeroSection />
            <ProductsSection />
            <AboutSection />
            <FeaturesStrip />
            <ContactSection />
            <SocialButtons />
        </div>
    );
}
